// ─── Vital Signs ─────────────────────────────────────────────────────────────

export interface VitalSigns {
    heart_rate: number | null;
    respiratory_rate: number | null;
    blood_pressure_sys: number | null;
    blood_pressure_dia: number | null;
    spo2_estimate: number | null;
    skin_temp: number | null;
    hrv_rmssd: number | null;
    hrv_sdnn: number | null;
    hrv_pnn50: number | null;
    stress_index: number | null;
    lf_hf_ratio: number | null;
    perfusion_index: number | null;
    sympathetic_activity: number | null;
    parasympathetic_activity: number | null;
    prq: number | null;
    wellness_score: number | null;
    // AI bloodless proxies
    hemoglobin: number | null;
    blood_glucose: number | null;
    hba1c: number | null;
    hydration_index: number | null;
    cardio_age: number | null;
    vascular_health: number | null;
    hypertension_risk: string | null;
    cardiac_index: number | null;
}

// ─── Signal Quality ───────────────────────────────────────────────────────────

export type QualityLevel = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'REJECTED';

export interface SignalQuality {
    snr_db: number;
    spectral_purity: number;
    motion_score: number;
    face_confidence: number;
    level: string;
    acceptable: boolean;
}

// ─── WebSocket Message Types ──────────────────────────────────────────────────

export interface MeasurementData {
    timestamp: string;
    face_detected: boolean;
    face_rect: [number, number, number, number] | null;
    estimated_age: number | null;
    estimated_gender: string | null;
    buffer_fill: number;
    fps_actual: number;
    message: string;
    vitals: VitalSigns;
    quality: SignalQuality;
    signal: number[];
    spectrum: number[];
    spectrum_freqs: number[];
}

export interface WSMessage {
    type: 'measurement' | 'error' | 'command_response' | 'stats';
    data?: MeasurementData;
    message?: string;
    command?: string;
    status?: string;
}

// ─── Application State ────────────────────────────────────────────────────────

export type AppScreen = 'startup' | 'scanning' | 'results';
export type ScanPhase = 'face' | 'vitals';

export interface ScanState {
    isRunning: boolean;
    scanPhase: ScanPhase;
    sessionId: string | null;
    timeLeft: number;
    bufferFill: number;
    fps: number;
    connected: boolean;
    message: string;
    messageType: 'info' | 'success' | 'error' | 'warning';
    currentVitals: VitalSigns | null;
    currentQuality: SignalQuality | null;
    faceDetected: boolean;
    faceRect: [number, number, number, number] | null;
    estimatedAge: number | null;
    estimatedGender: string | null;
    signalData: number[];
    spectrumData: number[];
    spectrumFreqs: number[];
    hrHistory: number[];
    rrHistory: number[];
    // Accumulation arrays for final median report
    allHR: number[];
    allRR: number[];
    allSys: number[];
    allDia: number[];
    allSpo2: number[];
    allTemp: number[];
    allHRV: number[];
    allSDNN: number[];
    allPNN50: number[];
    allStress: number[];
    allLFHF: number[];
    allPI: number[];
    allSympathetic: number[];
    allParasympathetic: number[];
    allPRQ: number[];
    allWellness: number[];
    allAge: number[];
    allGender: string[];
    allHemoglobin: number[];
    allGlucose: number[];
    allHbA1c: number[];
    allHydration: number[];
    allCardioAge: number[];
    allVascularHealth: number[];
    allHypertensionRisk: string[];
    allCardiacIndex: number[];
    goodMeasurements: number;
    totalMeasurements: number;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface FinalResults {
    heart_rate: number | null;
    respiratory_rate: number | null;
    blood_pressure_sys: number | null;
    blood_pressure_dia: number | null;
    spo2_estimate: number | null;
    skin_temp: number | null;
    hrv_rmssd: number | null;
    stress_index: number | null;
    sympathetic_activity: number | null;
    parasympathetic_activity: number | null;
    wellness_score: number | null;
    hemoglobin: number | null;
    glucose: number | null;
    hba1c: number | null;
    hydration: number | null;
    cardio_age: number | null;
    vascular_health: number | null;
    cardiac_index: number | null;
    htn_risk: string;
    estimatedAge: number | null;
    estimatedGender: string;
    confidence: number;
    sessionId: string;
}
