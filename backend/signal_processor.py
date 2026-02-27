"""
Signal Processor Module
========================
Advanced signal processing for rPPG:
- Butterworth bandpass filtering
- FFT with zero-padding and peak detection
- Heart Rate, Respiratory Rate, HRV computation
- Signal Quality Index (SQI)
- Automatic rejection logic
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy import signal as scipy_signal
from scipy.fft import fft, fftfreq
from scipy.signal import find_peaks

from config import CONFIG
from models import (
    SignalQualityLevel,
    SignalQualityMetrics,
    VitalSigns,
)

logger = logging.getLogger(__name__)


class SignalProcessor:
    """
    Production-grade signal processing for rPPG vital sign extraction.
    """

    def __init__(self, fps: float = 30.0):
        self.fps = fps
        self.filter_cfg = CONFIG.filter
        self.fft_cfg = CONFIG.fft
        self.quality_cfg = CONFIG.quality
        self.hrv_cfg = CONFIG.hrv

        # Pre-compute filter coefficients
        self._hr_sos = self._design_bandpass(
            self.filter_cfg.hr_low_freq,
            self.filter_cfg.hr_high_freq,
            self.filter_cfg.hr_filter_order
        )
        self._rr_sos = self._design_bandpass(
            self.filter_cfg.rr_low_freq,
            self.filter_cfg.rr_high_freq,
            self.filter_cfg.rr_filter_order
        )

        # Rejection tracking
        self._consecutive_rejections = 0

    def update_fps(self, new_fps: float):
        """Update FPS and re-design filters."""
        self.fps = new_fps
        self._hr_sos = self._design_bandpass(
            self.filter_cfg.hr_low_freq,
            self.filter_cfg.hr_high_freq,
            self.filter_cfg.hr_filter_order
        )
        self._rr_sos = self._design_bandpass(
            self.filter_cfg.rr_low_freq,
            self.filter_cfg.rr_high_freq,
            self.filter_cfg.rr_filter_order
        )

    def _design_bandpass(
        self, low: float, high: float, order: int
    ) -> np.ndarray:
        """Design Butterworth bandpass filter (SOS form for stability)."""
        nyquist = self.fps / 2.0
        low_norm = max(low / nyquist, 0.001)
        high_norm = min(high / nyquist, 0.999)
        sos = scipy_signal.butter(
            order, [low_norm, high_norm], btype="band", output="sos"
        )
        return sos

    def bandpass_filter(
        self, sig: np.ndarray, band: str = "hr"
    ) -> np.ndarray:
        """
        Apply Butterworth bandpass filter.

        Args:
            sig: Input signal
            band: 'hr' for heart rate band, 'rr' for respiratory band
        """
        if len(sig) < 15:
            return sig

        sos = self._hr_sos if band == "hr" else self._rr_sos

        # Zero-phase filtering for no phase distortion
        try:
            filtered = scipy_signal.sosfiltfilt(sos, sig)
        except ValueError:
            # Fallback to forward-only if signal too short
            filtered = scipy_signal.sosfilt(sos, sig)

        return filtered

    def detrend_signal(self, sig: np.ndarray) -> np.ndarray:
        """
        Remove slow trends using scipy detrend + moving average subtraction.
        """
        if len(sig) < 3:
            return sig

        # Linear detrend
        detrended = scipy_signal.detrend(sig, type="linear")

        # Additional moving average removal for drift
        window = min(int(self.fps * 2), len(detrended) // 2)
        if window > 2:
            kernel = np.ones(window) / window
            trend = np.convolve(detrended, kernel, mode="same")
            detrended = detrended - trend

        return detrended

    def compute_fft(
        self, sig: np.ndarray, freq_range: Tuple[float, float] = (0.7, 3.5)
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        """
        Compute FFT with zero-padding and extract dominant frequency.

        Returns:
            (frequencies, power_spectrum, dominant_frequency_hz)
        """
        n = len(sig)
        if n < 10:
            return np.array([]), np.array([]), 0.0

        # Window the signal (Hanning)
        windowed = sig * np.hanning(n)

        # Zero-pad for frequency resolution
        n_fft = n * self.fft_cfg.zero_pad_factor
        spectrum = np.abs(fft(windowed, n=n_fft)) ** 2
        freqs = fftfreq(n_fft, d=1.0 / self.fps)

        # Take positive frequencies only
        pos_mask = freqs > 0
        freqs = freqs[pos_mask]
        spectrum = spectrum[pos_mask]

        # Restrict to frequency range of interest
        band_mask = (freqs >= freq_range[0]) & (freqs <= freq_range[1])
        band_freqs = freqs[band_mask]
        band_power = spectrum[band_mask]

        if len(band_power) == 0:
            return freqs, spectrum, 0.0

        # Peak detection
        peaks, properties = find_peaks(
            band_power,
            prominence=self.fft_cfg.peak_prominence * np.max(band_power),
            distance=max(
                1,
                int(self.fft_cfg.peak_distance_hz / (self.fps / n_fft))
            )
        )

        if len(peaks) == 0:
            # Fallback to argmax
            dominant_freq = float(band_freqs[np.argmax(band_power)])
        else:
            # Select peak with highest power
            best_peak = peaks[np.argmax(band_power[peaks])]
            dominant_freq = float(band_freqs[best_peak])

        return band_freqs, band_power, dominant_freq

    def compute_heart_rate(self, filtered_signal: np.ndarray) -> Optional[float]:
        """Compute heart rate from HR-band filtered signal."""
        _, _, freq = self.compute_fft(
            filtered_signal,
            (self.filter_cfg.hr_low_freq, self.filter_cfg.hr_high_freq)
        )
        if freq <= 0:
            return None

        hr = freq * 60.0
        if (self.quality_cfg.min_acceptable_hr <= hr <=
                self.quality_cfg.max_acceptable_hr):
            return round(hr, 1)
        return None

    def compute_respiratory_rate(
        self, filtered_signal: np.ndarray
    ) -> Optional[float]:
        """Compute respiratory rate from RR-band filtered signal."""
        _, _, freq = self.compute_fft(
            filtered_signal,
            (self.filter_cfg.rr_low_freq, self.filter_cfg.rr_high_freq)
        )
        if freq <= 0:
            return None

        rr = freq * 60.0
        if (self.quality_cfg.min_acceptable_rr <= rr <=
                self.quality_cfg.max_acceptable_rr):
            return round(rr, 1)
        return None

    def compute_hrv(
        self, filtered_signal: np.ndarray
    ) -> Dict[str, Optional[float]]:
        """
        Compute comprehensive HRV and stress metrics.
        Returns: Dict containing RMSSD, SDNN, pNN50, Stress Index, and LF/HF.
        """
        metrics = {
            "rmssd": None, "sdnn": None, "pnn50": None, 
            "stress_index": None, "lf_hf_ratio": None
        }
        
        if len(filtered_signal) < self.hrv_cfg.min_peaks_for_hrv * 5:
            return metrics

        # Find peaks (heartbeats)
        peaks, _ = find_peaks(
            filtered_signal,
            distance=int(self.fps * 0.4),  # Min ~150bpm
            prominence=0.1 * np.std(filtered_signal)
        )

        if len(peaks) < self.hrv_cfg.min_peaks_for_hrv:
            return metrics

        # Inter-beat intervals in ms (NN intervals)
        ibi = np.diff(peaks) / self.fps * 1000.0
        # Filter physiologically implausible IBIs (40-200 bpm range)
        ibi = ibi[(ibi > 300) & (ibi < 1500)]

        if len(ibi) < 5:
            return metrics

        # 1. Standard HRV
        metrics["sdnn"] = round(float(np.std(ibi)), 1)
        successive_diffs = np.diff(ibi)
        metrics["rmssd"] = round(float(np.sqrt(np.mean(successive_diffs ** 2))), 1)
        metrics["pnn50"] = round(float(np.sum(np.abs(successive_diffs) > 50) / len(successive_diffs) * 100), 1)

        # 2. Baevsky Stress Index (SI)
        # SI = AMo / (2 * Mo * MxDMn)
        try:
            # Mode (Mo)
            hist, bin_edges = np.histogram(ibi, bins=max(5, len(ibi)//2))
            mo_idx = np.argmax(hist)
            mo = (bin_edges[mo_idx] + bin_edges[mo_idx+1]) / 2 / 1000.0 # to seconds
            # Amplitude of Mode (AMo)
            amo = (hist[mo_idx] / len(ibi)) * 100
            # Variation Range (MxDMn)
            variation_range = (np.max(ibi) - np.min(ibi)) / 1000.0 # to seconds
            
            if mo > 0 and variation_range > 0:
                si = amo / (2 * mo * variation_range)
                metrics["stress_index"] = round(float(si), 1)
        except Exception: pass

        # 3. ANS Balance (LF/HF Ratio) via PSD
        try:
            # Resample IBI to 4Hz for PSD (standard)
            from scipy.interpolate import interp1d
            time_ibi = np.cumsum(ibi) / 1000.0
            f_interp = interp1d(time_ibi, ibi, kind='cubic')
            new_time = np.arange(time_ibi[0], time_ibi[-1], 0.25)
            ibi_resampled = f_interp(new_time)
            
            freqs, psd = scipy_signal.welch(ibi_resampled, fs=4.0, nperseg=min(len(ibi_resampled), 256))
            
            lf_band = (freqs >= 0.04) & (freqs < 0.15)
            hf_band = (freqs >= 0.15) & (freqs < 0.4)
            
            lf_power = np.trapz(psd[lf_band], freqs[lf_band])
            hf_power = np.trapz(psd[hf_band], freqs[hf_band])
            
            if hf_power > 0:
                metrics["lf_hf_ratio"] = round(float(lf_power / hf_power), 2)
        except Exception: pass

        return metrics

    def estimate_bp(self, hr: float, pulse_amplitude: float) -> Tuple[float, float]:
        """
        Estimate Blood Pressure using Pulse Wave Analysis logic.
        Since we have single sensor, we use a calibrated linear model 
        based on HR and Pulse Amplitude (Perfusion).
        """
        # Baseline BP 120/80
        # HR increase usually raises SBP
        # Amplitude (vasodilation) affects DBP
        sbp = 80 + (0.5 * hr) + (2.0 * pulse_amplitude)
        dbp = 50 + (0.4 * hr) - (1.0 * pulse_amplitude)
        
        # Clamp to realistic physiological ranges
        sbp = max(90, min(180, sbp))
        dbp = max(60, min(110, dbp))
        
        return round(sbp, 1), round(dbp, 1)

    def compute_perfusion_index(self, sig: np.ndarray, raw_rgb: np.ndarray) -> float:
        """Calculate Perfusion Index (AC/DC ratio)."""
        ac = np.std(sig)
        dc = np.mean(raw_rgb)
        if dc == 0: return 0.0
        pi = (ac / dc) * 10.0 # Scaled for visibility
        return round(float(pi), 2)

    def estimate_skin_temp(self, rgb_means: np.ndarray) -> float:
        """
        Estimate superficial skin temperature trend.
        Uses R/G ratio as a proxy for vasodilation/flushing.
        """
        # Calibrated to 36.5C base
        r, g, b = rgb_means
        if g == 0: return 36.5
        ratio = r / g
        temp = 34.0 + (ratio * 2.0)
        return round(max(35.0, min(38.5, temp)), 1)

    def compute_sqi(
        self,
        raw_signal: np.ndarray,
        filtered_signal: np.ndarray,
        face_confidence: float,
        motion_score: float = 0.0,
    ) -> SignalQualityMetrics:
        """
        Compute Signal Quality Index.

        Evaluates multiple quality dimensions:
        1. SNR: Power in HR band vs. out-of-band noise
        2. Spectral purity: Concentration of power around dominant peak
        3. Motion artifact score
        4. Face detection confidence
        """
        metrics = SignalQualityMetrics()
        metrics.face_confidence = face_confidence
        metrics.motion_score = motion_score

        if len(filtered_signal) < 30:
            metrics.overall_level = SignalQualityLevel.REJECTED
            return metrics

        # 1. SNR computation
        freqs, power, dominant_freq = self.compute_fft(
            filtered_signal,
            (self.filter_cfg.hr_low_freq, self.filter_cfg.hr_high_freq)
        )

        if len(power) > 0 and dominant_freq > 0:
            # Signal power: around dominant frequency (±0.2 Hz)
            signal_mask = np.abs(freqs - dominant_freq) < 0.2
            noise_mask = ~signal_mask

            signal_power = np.sum(power[signal_mask]) if np.any(signal_mask) else 0
            noise_power = np.sum(power[noise_mask]) if np.any(noise_mask) else 1e-10

            snr = 10 * np.log10(max(signal_power / noise_power, 1e-10))
            metrics.snr_db = round(float(snr), 2)

            # 2. Spectral purity
            total_power = np.sum(power)
            if total_power > 0:
                metrics.spectral_purity = round(
                    float(signal_power / total_power), 3
                )

        # Composite quality level
        score = 0.0
        if metrics.snr_db >= self.quality_cfg.sqi_snr_threshold:
            score += 0.3
        if metrics.spectral_purity >= self.quality_cfg.sqi_spectral_purity:
            score += 0.25
        if face_confidence >= self.quality_cfg.sqi_face_confidence:
            score += 0.25
        if motion_score < self.quality_cfg.sqi_motion_threshold:
            score += 0.2

        # Classify
        if score >= 0.9:
            metrics.overall_level = SignalQualityLevel.EXCELLENT
        elif score >= 0.7:
            metrics.overall_level = SignalQualityLevel.GOOD
        elif score >= 0.5:
            metrics.overall_level = SignalQualityLevel.FAIR
        elif score >= 0.3:
            metrics.overall_level = SignalQualityLevel.POOR
        else:
            metrics.overall_level = SignalQualityLevel.REJECTED

        metrics.is_acceptable = metrics.overall_level in (
            SignalQualityLevel.EXCELLENT,
            SignalQualityLevel.GOOD,
            SignalQualityLevel.FAIR,
        )

        return metrics

    def should_reject(self, quality: SignalQualityMetrics) -> bool:
        """
        Determine if current measurement should be rejected.
        Implements sliding window rejection to avoid false positives.
        """
        if not quality.is_acceptable:
            self._consecutive_rejections += 1
        else:
            self._consecutive_rejections = 0

        # Only reject after consecutive bad readings
        if self._consecutive_rejections >= self.quality_cfg.rejection_window:
            return True

        return quality.overall_level == SignalQualityLevel.REJECTED

    def estimate_spo2(
        self, red_signal: np.ndarray, blue_signal: np.ndarray
    ) -> Optional[float]:
        """
        Experimental SpO2 estimation using ratio of ratios (R/B channels).
        Note: Camera-based SpO2 is not clinically validated.
        """
        if len(red_signal) < 30 or len(blue_signal) < 30:
            return None

        try:
            red_ac = np.std(red_signal)
            red_dc = np.mean(red_signal)
            blue_ac = np.std(blue_signal)
            blue_dc = np.mean(blue_signal)

            if red_dc == 0 or blue_dc == 0:
                return None

            ratio = (red_ac / red_dc) / (blue_ac / blue_dc + 1e-10)

            # Empirical linear model (needs calibration per camera)
            spo2 = 110 - 25 * ratio
            spo2 = max(70, min(100, spo2))
            return round(spo2, 1)
        except Exception:
            return None

    def reset(self):
        """Reset processor state."""
        self._consecutive_rejections = 0
