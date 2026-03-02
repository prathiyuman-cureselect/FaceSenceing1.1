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
        self._calibration_frames = 35  # Ultra-fast calibration (approx 3-4s at 10fps)
        self._calibration_progress = 0
        self._age_history = []
        self._gender_history = []
        self._sentiment_history = []
        
        self._stable_age = None
        self._stable_gender = None
        self._stable_sentiment = None
        
        # Persistence tracking
        self._last_vitals: Optional[VitalSigns] = None
        
        # History for result smoothing (Binah-style stability)
        self._hr_history: deque = deque(maxlen=10)
        self._rr_history: deque = deque(maxlen=10)
        self._spo2_history: deque = deque(maxlen=10)
        self._bp_history: deque = deque(maxlen=10) # List of (sys, dia) tuples
        
        # Motion estimation
        self._prev_gray: Optional[np.ndarray] = None
        self._motion_score: float = 0.0

        # Face Tracking Robustness
        self._face_lost_counter = 0
        self._max_face_lost = 15  # ~0.5s grace period
        
        # Session tracking
        self._frames_processed: int = 0
        self._start_time: float = time.time()
        self._last_measurement: Optional[MeasurementResult] = None

    def process_frame(self, frame: np.ndarray) -> MeasurementResult:
        """
        Premium rPPG pipeline with explicit Face Scanning phase and comprehensive vitals.
        """
        result = MeasurementResult()
        result.fps_actual = float(self.fps)

        # Step 1: High-precision Face detection
        face_rect, face_confidence = self.face_detector.detect_face(frame)
        
        if face_rect is None:
            self._face_lost_counter += 1
            if self._face_lost_counter <= self._max_face_lost:
                # Coasting on last known face position
                face_rect = self.face_detector._prev_face_rect
                face_confidence = 0.5 # Reduced confidence during coasting
                result.face_detected = face_rect is not None
            else:
                result.face_detected = False
        else:
            self._face_lost_counter = 0
            result.face_detected = True

        result.face_rect = face_rect

        if not result.face_detected:
            result.message = "Searching for face... position your head in the frame"
            result.buffer_fill = len(self._rgb_buffer) / self.config.buffer_size * 100
            return result

        # Step 1b: Face Scanning / Calibration Phase
        if self._is_calibrating:
            self._calibration_progress += 1
            est_age = self.face_detector.estimate_age(frame, face_rect)
            est_gender = self.face_detector.estimate_gender(frame, face_rect)
            est_sentiment = self.face_detector.estimate_sentiment(frame, face_rect)
            
            if est_age: self._age_history.append(est_age)
            if est_gender: self._gender_history.append(est_gender)
            if est_sentiment: 
                self._sentiment_history.append(est_sentiment)
            
            progress = (self._calibration_progress / self._calibration_frames) * 100
            result.message = f"Scanning Face... {min(100, progress):.0f}%"
            
            if self._calibration_progress >= self._calibration_frames:
                self._is_calibrating = False
                if self._age_history:
                    self._stable_age = int(np.median(self._age_history))
                if self._gender_history:
                    self._stable_gender = max(set(self._gender_history), key=self._gender_history.count)
                if self._sentiment_history:
                    self._stable_sentiment = max(set(self._sentiment_history), key=self._sentiment_history.count)
                else:
                    self._stable_sentiment = "Neutral"
                result.message = "PHASE_DETECTION_COMPLETE"
                self._face_lost_counter = 0 # Reset lost counter on valid scan phase
        
        self._frames_processed += 1 # Total frames processed (including no face)

        result.estimated_age = self._stable_age
        result.estimated_gender = self._stable_gender
        result.estimated_sentiment = self._stable_sentiment

        # Step 2: Motion Robustness
        self._estimate_motion(frame)
        if self._motion_score > 35.0:
            result.message = "✨ Stabilizing (Minor Motion Detected)..."
            # No early return here - keep processing!

        # Step 3: High-Fidelity Signal Extraction (Multi-Patch)
        # Only start signal extraction/vitals AFTER calibration is done
        if self._is_calibrating:
            return result

        rois = self.face_detector.extract_roi(frame, face_rect)
        
        # Flatten all patches from forehead and cheeks into one list
        all_patches = rois["forehead"] + rois["left_cheek"] + rois["right_cheek"]
        
        if not all_patches:
            # ROBUST FALLBACK: If specific sub-ROIs failed, use the core of the face as one large patch
            x, y, w, h = face_rect
            face_core = frame[y+int(h*0.3):y+int(h*0.7), x+int(w*0.3):x+int(w*0.7)]
            if face_core.size > 0:
                all_patches = [face_core]
            else:
                result.message = "Searching for stable skin area..."
                return result

        patch_signals = []
        for patch in all_patches:
            mask = self.face_detector.get_skin_mask(patch)
            # Relaxed skin mask threshold from 10% to 5% (already 5% with // 20)
            if mask.size > 0 and np.count_nonzero(mask) > (patch.size // 20): # 5% skin pixels is enough for signal
                # Use masked mean for precision
                b = np.mean(patch[:, :, 0][mask > 0])
                g = np.mean(patch[:, :, 1][mask > 0])
                r = np.mean(patch[:, :, 2][mask > 0])
                patch_signals.append(np.array([r, g, b]))
            else:
                # Fallback to simple mean if mask is too small (e.g. very zoomed in)
                patch_signals.append(np.mean(patch, axis=(0, 1))[::-1]) # BGR to RGB

        # Add current multi-patch snapshot to signal buffer
        # Buffer shape: (Time, Patches, 3)
        self._rgb_buffer.append(np.array(patch_signals))
        self._timestamp_buffer.append(time.time())

        buffer_len = len(self._rgb_buffer)
        result.buffer_fill = buffer_len / self.config.buffer_size * 100

        # Step 4: Intelligent Patch Fusion (Spatial-Temporal filtering)
        if buffer_len < 30: # 1 second of data
            result.message = f"Locking Pulse... {result.buffer_fill:.0f}%"
            return result
            
        logger.info(f"Processing signal buffer: {buffer_len} frames")

        # rgb_array shape: (Time, Patches, 3)
        rgb_array = np.array(self._rgb_buffer)
        
        # We process each patch independently and then fuse them based on signal quality (SNR)
        pulse_signal = self._fused_pos_algorithm(rgb_array)

        if pulse_signal is None:
            if self._last_vitals:
                result.vitals = self._last_vitals
                result.message = "⚡ Recovering signal from cache..."
                return result
            result.message = "Signal noise high - stay still..."
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
            # For color-based markers, we average all patches to get a stable 1D RGB signal
            rgb_1d = np.mean(rgb_array, axis=1) # (Time, 3)
            
            # Amplitude for BP: We use the STD of the filtered signal
            # Note: fused pulse was normalized, but we can recover physical amplitude 
            # by looking at the raw patch signals if needed. For now, use relative power.
            amp = np.std(hr_filtered) 
            
            vitals.blood_pressure_sys, vitals.blood_pressure_dia = self.signal_processor.estimate_bp(
                vitals.heart_rate, amp, hr_filtered=hr_filtered, rgb_array=rgb_1d
            )
            vitals.spo2_estimate = self.signal_processor.estimate_spo2(rgb_1d[:, 0], rgb_1d[:, 2])
            
            # --- Comprehensive Health Proxies ---
            if vitals.lf_hf_ratio is not None and vitals.lf_hf_ratio > 0:
                total = vitals.lf_hf_ratio + 1.0
                vitals.sympathetic_activity = round(min(100, (vitals.lf_hf_ratio / total) * 100), 1)
                vitals.parasympathetic_activity = round(min(100, (1.0 / total) * 100), 1)

            # Blood Markers (using averaged spatial signal)
            r_g_ratio = np.mean(rgb_1d[:, 0]) / (np.mean(rgb_1d[:, 1]) + 1e-10)
            vitals.hemoglobin = round(max(8.0, min(18.0, 14.5 + (r_g_ratio - 1.1) * 10)), 1)
            
            vitals.perfusion_index = self.signal_processor.compute_perfusion_index(hr_filtered, np.mean(rgb_1d, axis=0))
            vitals.blood_glucose = round(max(70.0, min(180.0, 100.0 + vitals.perfusion_index * 50)), 0)
            vitals.hba1c = round(max(4.0, min(10.0, 5.2 + (vitals.blood_glucose - 100) * 0.02)), 1)
            vitals.hydration_index = round(max(0, min(10.0, 8.5 - np.std(rgb_1d[:, 2]) * 100)), 1)
            
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

        # Final Rejection Logic — Only reject if no signal at all or extremely noisy
        if quality.overall_level == SignalQualityLevel.REJECTED:
            if not vitals.heart_rate:
                result.message = "Searching for pulse... keep still"
                return result
            # If we have a heart rate but quality is REJECTED, we still send it
            # but keep the message as Poor quality.
            result.message = "Signal quality: REJECTED"
        elif not vitals.heart_rate:
            result.message = "Calculating vitals..."
            return result
        else:
            result.message = f"Quality: {quality.overall_level.value.upper()}"
        
        # Stability check & Temporal Smoothing (Binah style)
        if 40 <= vitals.heart_rate <= 160:
            self._hr_history.append(vitals.heart_rate)
            vitals.heart_rate = round(float(np.median(self._hr_history)), 1)
            
        if 8 <= vitals.respiratory_rate <= 40:
            self._rr_history.append(vitals.respiratory_rate)
            vitals.respiratory_rate = round(float(np.median(self._rr_history)), 1)
            
        if vitals.spo2_estimate:
            self._spo2_history.append(vitals.spo2_estimate)
            vitals.spo2_estimate = round(float(np.median(self._spo2_history)), 1)
            
        if vitals.blood_pressure_sys:
            self._bp_history.append((vitals.blood_pressure_sys, vitals.blood_pressure_dia))
            vitals.blood_pressure_sys = round(float(np.median([p[0] for p in self._bp_history])), 1)
            vitals.blood_pressure_dia = round(float(np.median([p[1] for p in self._bp_history])), 1)

        result.vitals = vitals
        result.quality = quality
        
        # PERSISTENCE: If heartbeat is missing this frame, use last known stable value
        if not vitals.heart_rate and self._last_vitals:
            result.vitals = self._last_vitals
            result.message = "Stabilizing signal... please hold still"
        else:
            self._last_vitals = vitals
            result.message = f"Quality: {quality.overall_level.value.upper()}"
            
        return result

    def _fused_pos_algorithm(self, rgb_3d: np.ndarray) -> Optional[np.ndarray]:
        """
        Commercial-grade Fused POS Algorithm.
        Processes multiple patches and fuses them weighted by SNR.
        
        Args:
            rgb_3d: Array of shape (Time, Patches, 3)
        """
        n_frames, n_patches, _ = rgb_3d.shape
        
        all_pulses = []
        all_snrs = []
        
        for p in range(n_patches):
            patch_rgb = rgb_3d[:, p, :]
            pulse = self._pos_algorithm(patch_rgb)
            
            if pulse is not None:
                # Calculate SNR for this patch
                snr = self._calculate_signal_snr(pulse)
                if snr > 0.5: # Quality threshold
                    all_pulses.append(pulse)
                    all_snrs.append(snr)
        
        if not all_pulses:
            return None
            
        # SNR-weighted Fusion
        weights = np.array(all_snrs)
        weights = weights / np.sum(weights)
        
        fused_pulse = np.zeros(n_frames)
        for i, pulse in enumerate(all_pulses):
            # Normalize pulse to unit variance before fusion to avoid amplitude bias
            pulse_norm = (pulse - np.mean(pulse)) / (np.std(pulse) + 1e-10)
            fused_pulse += pulse_norm * weights[i]
            
        return fused_pulse

    def _calculate_signal_snr(self, signal: np.ndarray) -> float:
        """
        Estimate Signal-to-Noise ratio in the HR frequency band.
        """
        if len(signal) < 64: return 0.0
        
        # Power Spectral Density
        freqs, psd = self.signal_processor.compute_fft(signal)
        
        # Define HR band (0.7 - 3.0 Hz)
        hr_mask = (freqs >= 0.7) & (freqs <= 3.0)
        if not np.any(hr_mask): return 0.0
        
        # Find peak in HR band
        peak_idx = np.argmax(psd[hr_mask])
        peak_freq = freqs[hr_mask][peak_idx]
        
        # Signal power around peak (peak +/- 0.1 Hz)
        signal_mask = (freqs >= peak_freq - 0.1) & (freqs <= peak_freq + 0.1)
        signal_power = np.sum(psd[signal_mask])
        
        # Total power in the band
        total_band_power = np.sum(psd[hr_mask])
        
        noise_power = total_band_power - signal_power
        if noise_power <= 0: return 2.0 # Perfect signal
        
        return float(signal_power / noise_power)

    def _pos_algorithm(self, rgb: np.ndarray) -> Optional[np.ndarray]:
        """
        Base Plane-Orthogonal-to-Skin (POS) worker.
        """
        n = len(rgb)
        window = self.config.pos_window

        if n < window: return None

        # AC/DC Normalization
        mean_rgb = np.mean(rgb, axis=0)
        if np.any(mean_rgb < 1e-6): return None
        normalized = rgb / mean_rgb

        pulse = np.zeros(n)
        for t in range(window, n):
            segment = normalized[t - window: t]
            seg_mean = np.mean(segment, axis=0)
            if np.any(seg_mean < 1e-6): continue
            cn = segment / seg_mean

            s1 = cn[:, 1] - cn[:, 2]                  # G - B
            s2 = cn[:, 1] + cn[:, 2] - 2 * cn[:, 0]  # G + B - 2R

            std_s1 = np.std(s1)
            std_s2 = np.std(s2)
            if std_s2 < 1e-10: continue

            alpha = std_s1 / std_s2
            h = s1 + alpha * s2
            pulse[t - window: t] += (h - np.mean(h))

        return pulse

    def _estimate_motion(self, frame: np.ndarray):
        """Estimate frame-to-frame motion score."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (7, 7), 0)
        
        if self._prev_gray is not None:
            # Shift check
            diff = cv2.absdiff(gray, self._prev_gray)
            self._motion_score = np.mean(diff)
        
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
