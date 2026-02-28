"""
rPPG Pipeline Configuration
============================
Central configuration for camera, signal processing, and quality thresholds.
Designed for telemedicine kiosk / clinical-grade camera environments.
"""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CameraConfig:
    """Camera capture settings."""
    device_id: int = 0
    frame_width: int = 640
    frame_height: int = 480
    fps: float = 30.0
    warmup_frames: int = 30  # Frames to discard at startup


@dataclass
class ROIConfig:
    """Region of Interest extraction settings."""
    forehead_ratio_top: float = 0.15
    forehead_ratio_bottom: float = 0.45
    forehead_ratio_left: float = 0.25
    forehead_ratio_right: float = 0.75
    cheek_ratio_top: float = 0.55
    cheek_ratio_bottom: float = 0.85
    cheek_ratio_left: float = 0.15
    cheek_ratio_right: float = 0.85
    min_face_size: int = 80  # Minimum face width in pixels


@dataclass
class SignalConfig:
    """Signal processing parameters."""
    buffer_size: int = 150       # ~7.5 seconds at 20fps
    min_buffer_size: int = 20    # ~1 second minimum to start showing results instantly
    pos_window: int = 15         # Temporal window >= 0.5 heartbeat for stable processing
    detrend_lambda: float = 300  # Detrending smoothness parameter


@dataclass
class FilterConfig:
    """Butterworth filter parameters."""
    # Heart rate band: 0.7 Hz (42 bpm) to 4.0 Hz (240 bpm)
    hr_low_freq: float = 0.7
    hr_high_freq: float = 4.0
    hr_filter_order: int = 4

    # Respiratory rate band: 0.1 Hz (6 brpm) to 0.5 Hz (30 brpm)
    rr_low_freq: float = 0.1
    rr_high_freq: float = 0.5
    rr_filter_order: int = 3


@dataclass
class FFTConfig:
    """FFT and peak detection settings."""
    zero_pad_factor: int = 4     # Zero-padding multiplier for FFT
    peak_prominence: float = 0.05  # Lowered from 0.1 for higher sensitivity
    peak_distance_hz: float = 0.3  # Minimum distance between peaks in Hz


@dataclass
class QualityConfig:
    """Signal Quality Index thresholds."""
    sqi_snr_threshold: float = 1.0       # Relaxed from 3.0 for better initial tracking
    sqi_spectral_purity: float = 0.2     # Relaxed from 0.4
    sqi_motion_threshold: float = 20.0   # Slightly more tolerant to minor movement
    sqi_face_confidence: float = 0.5     # Min face detection confidence
    rejection_window: int = 15            # Give it more time to stabilize (30s) before rejection
    min_acceptable_hr: float = 40.0      # Minimum plausible HR
    max_acceptable_hr: float = 200.0     # Maximum plausible HR
    min_acceptable_rr: float = 6.0       # Minimum plausible RR
    max_acceptable_rr: float = 40.0      # Maximum plausible RR


@dataclass
class HRVConfig:
    """Heart Rate Variability settings."""
    min_peaks_for_hrv: int = 3    # Minimum peaks for HRV computation
    rmssd_max: float = 300.0      # Maximum plausible RMSSD (ms)
    sdnn_max: float = 500.0       # Maximum plausible SDNN (ms)


@dataclass
class ServerConfig:
    """Server / API settings."""
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list = field(default_factory=lambda: ["*"])
    ws_heartbeat_interval: float = 30.0
    max_sessions: int = 10


@dataclass
class PipelineConfig:
    """Master configuration aggregating all sub-configs."""
    camera: CameraConfig = field(default_factory=CameraConfig)
    roi: ROIConfig = field(default_factory=ROIConfig)
    signal: SignalConfig = field(default_factory=SignalConfig)
    filter: FilterConfig = field(default_factory=FilterConfig)
    fft: FFTConfig = field(default_factory=FFTConfig)
    quality: QualityConfig = field(default_factory=QualityConfig)
    hrv: HRVConfig = field(default_factory=HRVConfig)
    server: ServerConfig = field(default_factory=ServerConfig)

    @classmethod
    def from_env(cls) -> "PipelineConfig":
        """Create config from environment variables with defaults."""
        config = cls()
        config.camera.fps = float(os.getenv("RPPG_FPS", str(config.camera.fps)))
        config.signal.buffer_size = int(
            os.getenv("RPPG_BUFFER_SIZE", str(config.signal.buffer_size))
        )
        config.server.host = os.getenv("RPPG_HOST", config.server.host)
        config.server.port = int(os.getenv("RPPG_PORT", str(config.server.port)))
        
        # Load CORS origins from env (comma-separated string)
        cors_env = os.getenv("RPPG_CORS_ORIGINS")
        if cors_env:
            config.server.cors_origins = [o.strip() for o in cors_env.split(",")]
            
        return config


# Global singleton
CONFIG = PipelineConfig.from_env()
