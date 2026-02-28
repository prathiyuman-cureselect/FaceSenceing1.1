"""
Data Models for rPPG Pipeline
==============================
Pydantic models for request/response schemas, vital signs,
signal quality, and session management.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class SignalQualityLevel(str, Enum):
    """Signal quality classification levels."""
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    REJECTED = "rejected"


class VitalSigns(BaseModel):
    """Computed vital signs from rPPG analysis."""
    heart_rate: Optional[float] = Field(None, description="Heart rate in BPM")
    respiratory_rate: Optional[float] = Field(None, description="Respiratory rate in breaths/min")
    hrv_rmssd: Optional[float] = Field(None, description="HRV RMSSD in ms")
    hrv_sdnn: Optional[float] = Field(None, description="HRV SDNN in ms")
    hrv_pnn50: Optional[float] = Field(None, description="HRV pNN50 percentage")
    spo2_estimate: Optional[float] = Field(None, description="SpO2 estimate (experimental)")
    
    # New Advanced Metrics
    blood_pressure_sys: Optional[float] = Field(None, description="Systolic BP (estimated)")
    blood_pressure_dia: Optional[float] = Field(None, description="Diastolic BP (estimated)")
    stress_index: Optional[float] = Field(None, description="Baevsky Stress Index")
    lf_hf_ratio: Optional[float] = Field(None, description="Sympathetic/Parasympathetic balance")
    perfusion_index: Optional[float] = Field(None, description="Perfusion Index (AC/DC ratio)")
    skin_temp: Optional[float] = Field(None, description="Estimated Skin Temp (Celsius)")
    sympathetic_activity: Optional[float] = Field(None, description="Sympathetic nervous system activity (0-100)")
    parasympathetic_activity: Optional[float] = Field(None, description="Parasympathetic nervous system activity (0-100)")
    prq: Optional[float] = Field(None, description="Parasympathetic Recovery Quotient")
    wellness_score: Optional[float] = Field(None, description="Overall wellness score (0-10)")


class SignalQualityMetrics(BaseModel):
    """Signal quality assessment metrics."""
    snr_db: float = Field(0.0, description="Signal-to-Noise Ratio in dB")
    spectral_purity: float = Field(0.0, description="Spectral concentration ratio")
    motion_score: float = Field(0.0, description="Motion artifact score")
    face_confidence: float = Field(0.0, description="Face detection confidence")
    overall_level: SignalQualityLevel = SignalQualityLevel.REJECTED
    is_acceptable: bool = False


class MeasurementResult(BaseModel):
    """Complete measurement result sent to frontend."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    vitals: VitalSigns = Field(default_factory=VitalSigns)
    quality: SignalQualityMetrics = Field(default_factory=SignalQualityMetrics)
    raw_signal: List[float] = Field(default_factory=list, description="Filtered rPPG signal")
    spectrum: List[float] = Field(default_factory=list, description="Power spectrum")
    spectrum_freqs: List[float] = Field(default_factory=list, description="Frequency axis")
    buffer_fill: float = Field(0.0, description="Buffer fill percentage (0-100)")
    fps_actual: float = Field(0.0, description="Actual processing FPS")
    face_detected: bool = False
    face_rect: Optional[List[int]] = Field(None, description="Face bounding box [x, y, w, h]")
    message: str = ""


class SessionInfo(BaseModel):
    """Session metadata."""
    session_id: str
    start_time: datetime
    frames_processed: int = 0
    measurements_count: int = 0
    avg_hr: Optional[float] = None
    avg_rr: Optional[float] = None
    avg_sqi: Optional[float] = None


class SessionSummary(BaseModel):
    """End-of-session summary for EMR integration."""
    session_id: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    total_frames: int
    total_measurements: int
    accepted_measurements: int
    rejected_measurements: int
    average_vitals: VitalSigns
    quality_distribution: Dict[str, int]
    confidence_score: float = Field(
        0.0, description="Overall measurement confidence (0-1)"
    )
    emr_ready: bool = False


class HealthCheckResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    version: str = "1.0.0"
    uptime_seconds: float = 0.0
    active_sessions: int = 0


class ErrorResponse(BaseModel):
    """Error response model."""
    error: str
    detail: Optional[str] = None
    code: int = 500
