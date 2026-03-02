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
    SignalQualityLevel,
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

        # Calibration & Scanning State
        self._is_calibrating = True
        self._calibration_frames = 60  # ~2 seconds of "Face Scan"
        self._age_history = []
        self._gender_history = []
        self._stable_age = None
        self._stable_gender = None
        
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
        Premium rPPG pipeline with explicit Face Scanning phase and comprehensive vitals.
        """
        self._frames_processed += 1
        result = MeasurementResult()
        result.fps_actual = self._compute_actual_fps()

        # Step 1: High-precision Face detection
        face_rect, face_confidence = self.face_detector.detect_face(frame)
        result.face_detected = face_rect is not None
        result.face_rect = face_rect

        if not result.face_detected:
            result.message = "No face detected. Please position your face in the frame."
            result.buffer_fill = len(self._rgb_buffer) / self.config.buffer_size * 100
            return result

        # Step 1b: Face Scanning / Calibration Phase
        if self._is_calibrating:
            est_age = self.face_detector.estimate_age(frame, face_rect)
            est_gender = self.face_detector.estimate_gender(frame, face_rect)
            
            if est_age: self._age_history.append(est_age)
            if est_gender: self._gender_history.append(est_gender)
            
            progress = (self._frames_processed / self._calibration_frames) * 100
            result.message = f"Scanning Face... {min(100, progress):.0f}%"
            
            if self._frames_processed >= self._calibration_frames:
                self._is_calibrating = False
                if self._age_history:
                    self._stable_age = int(np.median(self._age_history))
                if self._gender_history:
                    self._stable_gender = max(set(self._gender_history), key=self._gender_history.count)
                logger.info(f"Calibration complete: {self._stable_gender}, {self._stable_age}")

        result.estimated_age = self._stable_age
        result.estimated_gender = self._stable_gender

        # Step 2: Motion Robustness
        self._estimate_motion(frame)
        if self._motion_score > 15.0:
            result.message = "Too much movement. Please stay still."
            return result

        # Step 3: Precise RGB extraction with Skin Masking
        rgb_signal = self.face_detector.extract_rgb_signal(frame, face_rect)
        if rgb_signal is None:
            result.message = "Searching for skin pixels..."
            return result

        # Add to rolling buffer
        self._rgb_buffer.append(rgb_signal)
        self._timestamp_buffer.append(time.time())

        buffer_len = len(self._rgb_buffer)
        result.buffer_fill = buffer_len / self.config.buffer_size * 100

        # Step 4: Core rPPG Processing (only when enough data)
        if buffer_len < self.config.min_buffer_size:
            if not self._is_calibrating:
                result.message = f"Analyzing Pulse... {result.buffer_fill:.0f}%"
            return result

        # Step 5: Advanced POS extraction
        rgb_array = np.array(self._rgb_buffer)
        pulse_signal = self._pos_algorithm(rgb_array)

        if pulse_signal is None:
            result.message = "Signal noise too high."
            return result

        self._pulse_signal = pulse_signal

        # Step 6: Signal Refinement & Vitals Extraction
        detrended = self.signal_processor.detrend_signal(pulse_signal)
        hr_filtered = self.signal_processor.bandpass_filter(detrended, "hr")
        rr_filtered = self.signal_processor.bandpass_filter(detrended, "rr")

        # Step 7: Vitals Computation
        vitals = VitalSigns()
        vitals.heart_rate = self.signal_processor.compute_heart_rate(hr_filtered)
        vitals.respiratory_rate = self.signal_processor.compute_respiratory_rate(rr_filtered)

        # HRV Metrics
        hrv_metrics = self.signal_processor.compute_hrv(hr_filtered)
        vitals.hrv_rmssd = hrv_metrics["rmssd"]
        vitals.stress_index = hrv_metrics["stress_index"]
        vitals.lf_hf_ratio = hrv_metrics["lf_hf_ratio"]

        # Advanced Vitals Estimation
        if vitals.heart_rate:
            amp = np.std(hr_filtered)
            vitals.blood_pressure_sys, vitals.blood_pressure_dia = self.signal_processor.estimate_bp(
                vitals.heart_rate, amp, hr_filtered=hr_filtered, rgb_array=rgb_array
            )
            vitals.spo2_estimate = self.signal_processor.estimate_spo2(rgb_array[:, 0], rgb_array[:, 2])
            
            # --- Comprehensive Health Proxies ---
            # SNS / PNS Activity
            if vitals.lf_hf_ratio is not None and vitals.lf_hf_ratio > 0:
                total = vitals.lf_hf_ratio + 1.0
                vitals.sympathetic_activity = round(min(100, (vitals.lf_hf_ratio / total) * 100), 1)
                vitals.parasympathetic_activity = round(min(100, (1.0 / total) * 100), 1)

            # Blood Markers
            r_g_ratio = np.mean(rgb_array[:, 0]) / (np.mean(rgb_array[:, 1]) + 1e-10)
            vitals.hemoglobin = round(max(8.0, min(18.0, 14.5 + (r_g_ratio - 1.1) * 10)), 1)
            
            vitals.perfusion_index = self.signal_processor.compute_perfusion_index(hr_filtered, np.mean(rgb_array, axis=0))
            vitals.blood_glucose = round(max(70.0, min(180.0, 100.0 + vitals.perfusion_index * 50)), 0)
            vitals.hba1c = round(max(4.0, min(10.0, 5.2 + (vitals.blood_glucose - 100) * 0.02)), 1)
            vitals.hydration_index = round(max(0, min(10.0, 8.5 - np.std(rgb_array[:, 2]) * 100)), 1)
            
            # Risks & Cardiovascular Age
            base_age = self._stable_age or 30
            vitals.cardio_age = int(base_age + (vitals.stress_index / 100 if vitals.stress_index else 0))
            vitals.vascular_health = round(max(0, min(100, 100 - (vitals.cardio_age - base_age) * 10)), 1)
            vitals.cardiac_index = round(max(2.0, min(4.5, 3.0 + (vitals.heart_rate - 70) * 0.01)), 2)
            
            if vitals.blood_pressure_sys > 140: vitals.hypertension_risk = "High"
            elif vitals.blood_pressure_sys > 130: vitals.hypertension_risk = "Elevated"
            else: vitals.hypertension_risk = "Low"

            # Wellness Score
            ws_comp = []
            if vitals.heart_rate: ws_comp.append(max(0, 10 - abs(vitals.heart_rate - 70) * 0.2))
            if vitals.stress_index: ws_comp.append(max(0, 10 - vitals.stress_index / 100))
            if vitals.vascular_health: ws_comp.append(vitals.vascular_health / 10.0)
            if ws_comp: vitals.wellness_score = round(sum(ws_comp) / len(ws_comp), 1)

        # Step 8: Quality Assurance
        quality = self.signal_processor.compute_sqi(
            raw_signal=pulse_signal,
            filtered_signal=hr_filtered,
            face_confidence=face_confidence,
            motion_score=self._motion_score,
        )

        # Final Rejection Logic — Prevent "Abnormal" data
        if quality.overall_level == SignalQualityLevel.REJECTED or vitals.heart_rate is None:
            result.message = "Poor signal quality. Checking..."
            return result
        
        # Stability check: Only add to history if readings are physically plausible
        if 40 <= vitals.heart_rate <= 160:
            self._hr_history.append(vitals.heart_rate)
        if 8 <= vitals.respiratory_rate <= 40:
            self._rr_history.append(vitals.respiratory_rate)

        result.vitals = vitals
        result.quality = quality
        result.message = f"Quality: {quality.overall_level.value.upper()}"
        
        return result

    def _pos_algorithm(self, rgb: np.ndarray) -> Optional[np.ndarray]:
        """
        Plane-Orthogonal-to-Skin (POS) algorithm with Amplitude Preservation.
        """
        n = len(rgb)
        window = self.config.pos_window

        if n < window:
            return None

        # AC/DC Normalization
        mean_rgb = np.mean(rgb, axis=0)
        if np.any(mean_rgb < 1e-6):
            return None
        normalized = rgb / mean_rgb

        pulse = np.zeros(n)
        for t in range(window, n):
            segment = normalized[t - window: t]
            seg_mean = np.mean(segment, axis=0)
            if np.any(seg_mean < 1e-6):
                continue
            cn = segment / seg_mean

            # Projections
            s1 = cn[:, 1] - cn[:, 2]                  # G - B
            s2 = cn[:, 1] + cn[:, 2] - 2 * cn[:, 0]  # G + B - 2R

            std_s1 = np.std(s1)
            std_s2 = np.std(s2)
            if std_s2 < 1e-10:
                continue

            alpha = std_s1 / std_s2
            h = s1 + alpha * s2
            
            # Overlap-add with partial normalization
            # We keep the scale of 'h' (which represents the AC/DC pulse strength)
            pulse[t - window: t] += (h - np.mean(h))

        return pulse

    def _estimate_motion(self, frame: np.ndarray):
        """
        Estimate motion using simple frame differencing for speed.
        High motion indicates potential artifacts.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (80, 60))  # Downsample heavily for speed

        if self._prev_gray is not None:
            # Simple absolute difference instead of expensive optical flow
            diff = cv2.absdiff(self._prev_gray, gray)
            self._motion_score = float(np.mean(diff))
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

    def set_calibration(self, calib_data: Dict):
        """Set user-specific calibration baselines."""
        self.signal_processor.set_calibration(calib_data)
        logger.info(f"Calibration updated: {calib_data}")

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
