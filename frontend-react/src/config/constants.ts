// ─── Configuration Constants ──────────────────────────────────────────────────

const PROTOCOL: 'wss:' | 'ws:' = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const HOSTNAME = window.location.hostname || 'localhost';
const PORT =
    HOSTNAME === 'localhost' || HOSTNAME.includes('192.168.') ? ':8000' : '';

export const CONFIG = {
    WS_URL: `${PROTOCOL}//${HOSTNAME}${PORT}/ws`,
    FRAME_INTERVAL_MS: 100, // 10 fps
    JPEG_QUALITY: 0.5,
    MAX_RECONNECT_ATTEMPTS: 10,
    RECONNECT_DELAY_MS: 2000,
    SPARKLINE_MAX_POINTS: 60,
    SIGNAL_CHART_POINTS: 100,
    SPECTRUM_CHART_POINTS: 100,
    SCAN_DURATION_SECONDS: 40,

    COLORS: {
        heart: '#ef4444',
        heartDim: 'rgba(239, 68, 68, 0.3)',
        breath: '#06b6d4',
        breathDim: 'rgba(6, 182, 212, 0.3)',
        hrv: '#8b5cf6',
        hrvDim: 'rgba(139, 92, 246, 0.3)',
        spo2: '#f59e0b',
        signal: '#3b82f6',
        signalGlow: 'rgba(59, 130, 246, 0.2)',
        spectrum: '#10b981',
        spectrumFill: 'rgba(16, 185, 129, 0.15)',
        grid: 'rgba(255, 255, 255, 0.04)',
        gridText: 'rgba(255, 255, 255, 0.2)',
        qualityExcellent: '#10b981',
        qualityGood: '#06b6d4',
        qualityFair: '#f59e0b',
        qualityPoor: '#ef4444',
        qualityRejected: '#6b7280',
    },
} as const;
