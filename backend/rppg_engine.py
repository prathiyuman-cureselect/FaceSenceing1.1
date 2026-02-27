"""
rPPG Engine — POS Algorithm Implementation
============================================
Core rPPG pipeline implementing the Plane-Orthogonal-to-Skin (POS) algorithm
for motion-robust pulse signal extraction from facial video.

Reference:
    Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017).
    "Algorithmic Principles of Remote PPG."
    IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
"""

import logging
import time
from collections import deque
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from config import CONFIG
from face_detector import FaceDetector
from models import (
    MeasurementResult,
    SignalQualityMetrics,
    VitalSigns,
)
from signal_processor import SignalProcessor

logger = logging.getLogger(__name__)


class RPPGEngine:
    """
    Production rPPG engine with POS algorithm.

    Pipeline:
    1. Face detection & ROI extraction
    2. Skin-color signal extraction (RGB means)
    3. POS algorithm for pulse signal extraction
    4. Butterworth bandpass filtering
    5. FFT + peak detection for HR/RR
    6. HRV computation
    7. Signal quality assessment
    8. Automatic rejection logic
    """

    def __init__(self, fps: float = None):
        self.fps = fps or CONFIG.camera.fps
        self.config = CONFIG.signal
        self.face_detector = FaceDetector()
        self.signal_processor = SignalProcessor(self.fps)

        # Signal buffers
        self._rgb_buffer: deque = deque(maxlen=self.config.buffer_size)
        self._timestamp_buffer: deque = deque(maxlen=self.config.buffer_size)
        self._pulse_signal: np.ndarray = np.array([])

        # Motion estimation
        self._prev_gray: Optional[np.ndarray] = None
        self._motion_score: float = 0.0

        # Session tracking
        self._frames_processed: int = 0
        self._start_time: float = time.time()
        self._last_measurement: Optional[MeasurementResult] = None

        # Measurement history for averaging
        self._hr_history: deque = deque(maxlen=30)
        self._rr_history: deque = deque(maxlen=30)

    def process_frame(self, frame: np.ndarray) -> MeasurementResult:
        """
        Process a single video frame through the rPPG pipeline.

        Args:
            frame: BGR image from camera

        Returns:
            MeasurementResult with vitals, quality, and signal data
        """
        self._frames_processed += 1
        result = MeasurementResult()
        result.fps_actual = self._compute_actual_fps()

        # Step 1: Face detection
        face_rect, face_confidence = self.face_detector.detect_face(frame)
        result.face_detected = face_rect is not None

        if not result.face_detected:
            result.message = "No face detected. Please position your face in the frame."
            result.buffer_fill = len(self._rgb_buffer) / self.config.buffer_size * 100
            return result

        # Step 2: Motion estimation
        self._estimate_motion(frame)

        # Step 3: RGB signal extraction
        rgb_signal = self.face_detector.extract_rgb_signal(frame, face_rect)
        if rgb_signal is None:
            result.message = "Unable to extract skin signal. Ensure good lighting."
            result.buffer_fill = len(self._rgb_buffer) / self.config.buffer_size * 100
            return result

        # Add to buffer
        self._rgb_buffer.append(rgb_signal)
        self._timestamp_buffer.append(time.time())

        buffer_len = len(self._rgb_buffer)
        result.buffer_fill = buffer_len / self.config.buffer_size * 100

        # Need minimum buffer for analysis
        if buffer_len < self.config.min_buffer_size:
            result.message = (
                f"Collecting data... {result.buffer_fill:.0f}% "
                f"({buffer_len}/{self.config.min_buffer_size} frames needed)"
            )
            return result

        # Step 4: POS Algorithm
        rgb_array = np.array(self._rgb_buffer)
        pulse_signal = self._pos_algorithm(rgb_array)

        if pulse_signal is None or len(pulse_signal) < 30:
            result.message = "Insufficient signal quality for POS extraction."
            return result

        self._pulse_signal = pulse_signal

        # Step 5: Detrend
        detrended = self.signal_processor.detrend_signal(pulse_signal)

        # Step 6: Bandpass filter (HR band)
        hr_filtered = self.signal_processor.bandpass_filter(detrended, "hr")

        # Step 7: Bandpass filter (RR band)
        rr_filtered = self.signal_processor.bandpass_filter(detrended, "rr")

        # Step 8: Compute vitals
        vitals = VitalSigns()
        vitals.heart_rate = self.signal_processor.compute_heart_rate(hr_filtered)
        vitals.respiratory_rate = self.signal_processor.compute_respiratory_rate(
            rr_filtered
        )

        # 1. Advanced HRV (RMSSD, SDNN, pNN50, Stress, LF/HF)
        hrv_metrics = self.signal_processor.compute_hrv(hr_filtered)
        vitals.hrv_rmssd = hrv_metrics["rmssd"]
        vitals.hrv_sdnn = hrv_metrics["sdnn"]
        vitals.hrv_pnn50 = hrv_metrics["pnn50"]
        vitals.stress_index = hrv_metrics["stress_index"]
        vitals.lf_hf_ratio = hrv_metrics["lf_hf_ratio"]

        # 2. Blood Pressure (Estimated)
        if vitals.heart_rate:
            # use signal amplitude as proxy for pulse pressure
            amp = np.std(hr_filtered)
            sys, dia = self.signal_processor.estimate_bp(vitals.heart_rate, amp)
            vitals.blood_pressure_sys = sys
            vitals.blood_pressure_dia = dia

        # 3. Perfusion Index
        vitals.perfusion_index = self.signal_processor.compute_perfusion_index(
            hr_filtered, np.mean(rgb_array, axis=0)
        )

        # 4. Temperature
        vitals.skin_temp = self.signal_processor.estimate_skin_temp(self._rgb_buffer[-1])

        # 5. Experimental SpO2
        vitals.spo2_estimate = self.signal_processor.estimate_spo2(
            rgb_array[:, 0],  # Red channel
            rgb_array[:, 2],  # Blue channel
        )

        # Step 9: Signal Quality
        quality = self.signal_processor.compute_sqi(
            raw_signal=pulse_signal,
            filtered_signal=hr_filtered,
            face_confidence=face_confidence,
            motion_score=self._motion_score,
        )

        # Step 10: Rejection logic
        if self.signal_processor.should_reject(quality):
            result.message = "Signal rejected due to poor quality. Hold still."
            quality.is_acceptable = False
        else:
            # Track valid measurements
            if vitals.heart_rate is not None:
                self._hr_history.append(vitals.heart_rate)
            if vitals.respiratory_rate is not None:
                self._rr_history.append(vitals.respiratory_rate)

            result.message = f"Quality: {quality.overall_level.value}"

        # Prepare spectrum for frontend
        freqs, power, _ = self.signal_processor.compute_fft(
            hr_filtered,
            (CONFIG.filter.hr_low_freq, CONFIG.filter.hr_high_freq)
        )

        result.vitals = vitals
        result.quality = quality
        result.raw_signal = hr_filtered[-200:].tolist()  # Last ~7s
        result.spectrum = (power / (np.max(power) + 1e-10)).tolist() if len(power) > 0 else []
        result.spectrum_freqs = freqs.tolist() if len(freqs) > 0 else []

        self._last_measurement = result
        return result

    def _pos_algorithm(self, rgb: np.ndarray) -> Optional[np.ndarray]:
        """
        Plane-Orthogonal-to-Skin (POS) algorithm.

        The POS method projects the temporal RGB signal onto a plane
        orthogonal to the skin-tone direction, making it robust to
        motion artifacts and illumination changes.

        Args:
            rgb: Array of shape (N, 3) with [R, G, B] means per frame

        Returns:
            Extracted pulse signal or None
        """
        n = len(rgb)
        window = self.config.pos_window

        if n < window:
            return None

        # Normalize RGB channels
        mean_rgb = np.mean(rgb, axis=0)
        if np.any(mean_rgb < 1e-6):
            return None

        normalized = rgb / mean_rgb

        # POS projection
        pulse = np.zeros(n)

        for t in range(window, n):
            segment = normalized[t - window: t]

            # Temporal normalization
            seg_mean = np.mean(segment, axis=0)
            if np.any(seg_mean < 1e-6):
                continue
            cn = segment / seg_mean

            # POS projection matrix
            # S1 = G - B, S2 = G + B - 2R
            s1 = cn[:, 1] - cn[:, 2]       # G - B
            s2 = cn[:, 1] + cn[:, 2] - 2 * cn[:, 0]  # G + B - 2R

            # Adaptive alpha
            std_s1 = np.std(s1)
            std_s2 = np.std(s2)

            if std_s2 < 1e-10:
                continue

            alpha = std_s1 / std_s2

            # Pulse signal
            h = s1 + alpha * s2

            # Overlap-add
            pulse[t - window: t] += (h - np.mean(h)) / (np.std(h) + 1e-10)

        # Normalize output
        std = np.std(pulse)
        if std < 1e-10:
            return None

        pulse = (pulse - np.mean(pulse)) / std

        return pulse

    def _estimate_motion(self, frame: np.ndarray):
        """
        Estimate motion using optical flow magnitude.
        High motion indicates potential artifacts.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (160, 120))  # Downsample for speed

        if self._prev_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(
                self._prev_gray, gray,
                None, 0.5, 3, 15, 3, 5, 1.2, 0
            )
            magnitude = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
            self._motion_score = float(np.mean(magnitude))
        else:
            self._motion_score = 0.0

        self._prev_gray = gray

    def _compute_actual_fps(self) -> float:
        """Compute actual processing FPS."""
        if len(self._timestamp_buffer) < 2:
            return 0.0

        elapsed = self._timestamp_buffer[-1] - self._timestamp_buffer[0]
        if elapsed <= 0:
            return 0.0

        return round((len(self._timestamp_buffer) - 1) / elapsed, 1)

    def get_averaged_vitals(self) -> Dict:
        """Get averaged vitals from history (more stable readings)."""
        result = {}
        if self._hr_history:
            result["avg_hr"] = round(np.median(list(self._hr_history)), 1)
        if self._rr_history:
            result["avg_rr"] = round(np.median(list(self._rr_history)), 1)
        return result

    def get_session_stats(self) -> Dict:
        """Get current session statistics."""
        return {
            "frames_processed": self._frames_processed,
            "buffer_size": len(self._rgb_buffer),
            "uptime_seconds": round(time.time() - self._start_time, 1),
            "averaged_vitals": self.get_averaged_vitals(),
        }

    def reset(self):
        """Full pipeline reset."""
        self._rgb_buffer.clear()
        self._timestamp_buffer.clear()
        self._pulse_signal = np.array([])
        self._prev_gray = None
        self._motion_score = 0.0
        self._frames_processed = 0
        self._start_time = time.time()
        self._hr_history.clear()
        self._rr_history.clear()
        self.face_detector.reset()
        self.signal_processor.reset()
        logger.info("rPPG engine reset")
