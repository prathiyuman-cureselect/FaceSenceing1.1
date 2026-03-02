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
    BUFFER_SIZE_FRAMES: 60, // 6 seconds at 10fps

    COLORS: {
        heart: '#ef4444',
        heartDim: 'rgba(239, 68, 68, 0.3)',
        breath: '#10b981',
        breathDim: 'rgba(16, 185, 129, 0.3)',
        hrv: '#8b5cf6',
        hrvDim: 'rgba(139, 92, 246, 0.3)',
        spo2: '#fbbf24',
        signal: '#10b981',
        signalGlow: 'rgba(16, 185, 129, 0.2)',
        spectrum: '#059669',
        spectrumFill: 'rgba(5, 150, 105, 0.15)',
        grid: 'rgba(0, 0, 0, 0.04)',
        gridText: 'rgba(0, 0, 0, 0.2)',
        qualityExcellent: '#059669',
        qualityGood: '#10b981',
        qualityFair: '#fbbf24',
        qualityPoor: '#f87171',
        qualityRejected: '#94a3b8',
    },
} as const;
