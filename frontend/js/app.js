/**
 * ═══════════════════════════════════════════════════════════════════════
 * TelegarudaAI — Frontend Application
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Real-time camera capture → WebSocket → rPPG Backend → Dashboard
 * 
 * Features:
 * - WebRTC camera access with optimal settings
 * - WebSocket communication with auto-reconnect
 * - Real-time waveform and spectrum rendering (Canvas 2D)
 * - Sparkline history charts per vital
 * - Signal quality ring animations
 * - Session management
 */

'use strict';

// ─── Configuration ────────────────────────────────────────────────────
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const HOSTNAME = window.location.hostname || 'localhost';
// Local port if on local network, otherwise no port for tunnels
const PORT = (HOSTNAME === 'localhost' || HOSTNAME.includes('192.168.')) ? ':8000' : '';

const CONFIG = {
    WS_URL: `${PROTOCOL}//${HOSTNAME}${PORT}/ws`,
    FRAME_INTERVAL_MS: 100,       // 10 fps capture rate to massively reduce JS thread blocking on low-end devices
    JPEG_QUALITY: 0.5,             // Reduced quality so the frame is sent instantaneously
    MAX_RECONNECT_ATTEMPTS: 10,
    RECONNECT_DELAY_MS: 2000,
    SPARKLINE_MAX_POINTS: 60,
    SIGNAL_CHART_POINTS: 100,
    SPECTRUM_CHART_POINTS: 100,

    // Color palette
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
};

// ─── State ────────────────────────────────────────────────────────────
const state = {
    sessionId: null,
    ws: null,
    stream: null,
    captureInterval: null,
    isRunning: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    scanTimerInterval: null,
    timeLeft: 35,

    // Vital histories (for sparklines)
    hrHistory: [],
    rrHistory: [],
    hrvHistory: [],
    spo2History: [],

    // Chart data
    signalData: [],
    spectrumData: [],
    spectrumFreqs: [],

    // Accumulation arrays — collect ALL measurements for median
    allHR: [],
    allRR: [],
    allSys: [],
    allDia: [],
    allSpo2: [],
    allTemp: [],
    allHRV: [],
    allSDNN: [],
    allPNN50: [],
    allStress: [],
    allLFHF: [],
    allPI: [],
    allSympathetic: [],
    allParasympathetic: [],
    allPRQ: [],
    allWellness: [],
    allAge: [],
    allGender: [],

    // Bloodless Blood Tests & Risk Proxies
    allHemoglobin: [],
    allGlucose: [],
    allHbA1c: [],
    allHydration: [],
    allCardioAge: [],
    allVascularHealth: [],
    allHypertensionRisk: [],
    allCardiacIndex: [],
    scanPhase: 'face', // 'face' or 'vitals'
    goodMeasurements: 0,
    totalMeasurements: 0,
};

// ─── DOM References ───────────────────────────────────────────────────
const DOM = {
    startupOverlay: document.getElementById('startupOverlay'),
    resultsOverlay: document.getElementById('resultsOverlay'),
    resultsGrid: document.getElementById('resultsGrid'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnReset: document.getElementById('btnReset'),
    btnScanAgain: document.getElementById('btnScanAgain'),

    videoFeed: document.getElementById('videoFeed'),
    canvas: document.getElementById('canvasHidden'),
    videoWrapper: document.getElementById('videoWrapper'),
    faceGuideText: document.querySelector('#faceGuide span'),
    recChip: document.getElementById('recChip'),
    timerChip: document.getElementById('timerChip'),
    timerText: document.getElementById('timerText'),
    qualityChip: document.getElementById('qualityChip'),
    qualityChipText: document.getElementById('qualityChipText'),

    bufferFill: document.getElementById('bufferFill'),
    bufferLabel: document.getElementById('bufferLabel'),

    fpsBadge: document.getElementById('fpsBadge'),
    sessionDot: document.getElementById('sessionDot'),
    sessionLabel: document.getElementById('sessionLabel'),

    messageBar: document.getElementById('messageBar'),
    messageText: document.getElementById('messageText'),

    // Vitals
    hrValue: document.getElementById('hrValue'),
    rrValue: document.getElementById('rrValue'),
    hrvValue: document.getElementById('hrvValue'),
    sdnnValue: document.getElementById('sdnnValue'),
    pnn50Value: document.getElementById('pnn50Value'),
    hrvStatus: document.getElementById('hrvStatus'),
    spo2Value: document.getElementById('spo2Value'),

    // Sparklines
    sparklineHR: document.getElementById('sparklineHR'),
    sparklineRR: document.getElementById('sparklineRR'),

    // Quality rings
    ringSnrFg: document.getElementById('ringSnrFg'),
    ringSpectralFg: document.getElementById('ringSpectralFg'),
    ringMotionFg: document.getElementById('ringMotionFg'),
    ringFaceFg: document.getElementById('ringFaceFg'),
    snrValue: document.getElementById('snrValue'),
    spectralValue: document.getElementById('spectralValue'),
    motionValue: document.getElementById('motionValue'),
    faceValue: document.getElementById('faceValue'),
    sqiLevelBadge: document.getElementById('sqiLevelBadge'),
    sqiLevelText: document.getElementById('sqiLevelText'),

    // Charts
    chartSignal: document.getElementById('chartSignal'),
    chartSpectrum: document.getElementById('chartSpectrum'),

    // Summary modal
    summaryModal: document.getElementById('summaryModal'),
    summaryGrid: document.getElementById('summaryGrid'),
    btnCloseSummary: document.getElementById('btnCloseSummary'),
};

// ─── Initialization ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    resizeChartCanvases();
    window.addEventListener('resize', resizeChartCanvases);
});

function setupEventListeners() {
    DOM.btnStart.addEventListener('click', startSession);
    DOM.btnStop.addEventListener('click', stopSession);
    DOM.btnReset.addEventListener('click', resetSession);
    DOM.btnCloseSummary.addEventListener('click', () => {
        DOM.summaryModal.classList.remove('visible');
    });
    if (DOM.btnScanAgain) {
        DOM.btnScanAgain.addEventListener('click', () => {
            DOM.resultsOverlay.classList.remove('visible');
            DOM.startupOverlay.classList.remove('hidden');
            DOM.btnStart.disabled = false;
        });
    }
}

function resizeChartCanvases() {
    [DOM.chartSignal, DOM.chartSpectrum].forEach(canvas => {
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        canvas.style.width = parent.clientWidth + 'px';
        canvas.style.height = parent.clientHeight + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    });

    [DOM.sparklineHR, DOM.sparklineRR].forEach(canvas => {
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = 36 * dpr;
        canvas.style.width = parent.clientWidth + 'px';
        canvas.style.height = '36px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    });
}

// ─── Camera Access ────────────────────────────────────────────────────
async function initCamera() {
    // Check for secure context
    const isSecure = window.isSecureContext || window.location.hostname === 'localhost';
    if (!isSecure) {
        const errMsg = "❌ Camera Blocked: Browsers require HTTPS or Localhost for camera access.";
        updateMessage(errMsg, 'error');
        alert(errMsg + "\n\nPlease use the HTTPS link I provided instead of the IP address.");
        return false;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("❌ Browser Not Supported: Your browser does not support camera access or is blocking it (Common on iOS Chrome/Firefox, use Safari instead).");
            return false;
        }

        updateMessage('🔄 Requesting camera permission...', 'info');

        // Try with flexible constraints for better mobile support
        const constraints = {
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("Retrying with simple constraints...");
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        state.stream = stream;
        DOM.videoFeed.srcObject = stream;
        DOM.videoFeed.setAttribute('playsinline', ''); // Essential for iOS
        DOM.videoFeed.muted = true;

        // Force a play gesture
        await DOM.videoFeed.play();

        // Wait for metadata to settle
        if (DOM.videoFeed.videoWidth) {
            DOM.canvas.width = DOM.videoFeed.videoWidth;
            DOM.canvas.height = DOM.videoFeed.videoHeight;
        }

        updateMessage('📸 Camera active. Connecting to server...', 'info');
        return true;
    } catch (err) {
        const userMsg = `❌ Camera Error: ${err.name} - ${err.message}`;
        updateMessage(userMsg, 'error');
        alert(userMsg + "\n\nTry refreshing the page or checking browser permissions.");
        console.error('Camera init failed:', err);
        return false;
    }
}

function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
        state.stream = null;
    }
    DOM.videoFeed.srcObject = null;
}

// ─── WebSocket Connection ─────────────────────────────────────────────
function connectWebSocket() {
    state.sessionId = generateSessionId();
    const url = `${CONFIG.WS_URL}/${state.sessionId}`;

    updateMessage('🔌 Connecting to rPPG server...', 'info');
    DOM.sessionLabel.textContent = 'Connecting...';

    try {
        state.ws = new WebSocket(url);
    } catch (err) {
        updateMessage(`❌ WebSocket error: ${err.message}`, 'error');
        return;
    }

    state.ws.onopen = () => {
        state.reconnectAttempts = 0;
        DOM.sessionDot.classList.add('active');
        DOM.sessionLabel.textContent = `Session: ${state.sessionId}`;
        updateMessage('✅ Connected! Position your face and hold still.', 'success');

        // Send calibration if values exist
        const calib = {};
        if (DOM.calibSys && DOM.calibSys.value) calib.baseline_sys = parseFloat(DOM.calibSys.value);
        if (DOM.calibDia && DOM.calibDia.value) calib.baseline_dia = parseFloat(DOM.calibDia.value);
        if (DOM.calibTemp && DOM.calibTemp.value) calib.baseline_temp = parseFloat(DOM.calibTemp.value);
        if (DOM.calibSpo2 && DOM.calibSpo2.value) calib.baseline_spo2 = parseFloat(DOM.calibSpo2.value);

        if (Object.keys(calib).length > 0) {
            state.ws.send(JSON.stringify({ command: 'calibrate', data: calib }));
        }

        startFrameCapture();
    };

    state.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'measurement') {
                handleMeasurement(msg.data);
            } else if (msg.type === 'error') {
                console.warn('Server error:', msg.message);
            } else if (msg.type === 'command_response') {
                console.log('Command OK:', msg.command);
            }
        } catch (err) {
            console.error('Message parse error:', err);
        }
    };

    state.ws.onclose = (event) => {
        DOM.sessionDot.classList.remove('active');
        DOM.sessionLabel.textContent = 'Disconnected';
        stopFrameCapture();

        if (state.isRunning && state.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
            state.reconnectAttempts++;
            updateMessage(
                `🔄 Reconnecting (${state.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`,
                'info'
            );
            state.reconnectTimer = setTimeout(connectWebSocket, CONFIG.RECONNECT_DELAY_MS);
        } else if (state.isRunning) {
            updateMessage('❌ Connection lost. Please restart.', 'error');
            state.isRunning = false;
        }
    };

    state.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function disconnectWebSocket() {
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    if (state.ws) {
        state.ws.onclose = null;  // Prevent reconnect
        state.ws.close();
        state.ws = null;
    }
    DOM.sessionDot.classList.remove('active');
    DOM.sessionLabel.textContent = 'Disconnected';
}

// ─── Frame Capture & Transmission ─────────────────────────────────────
function startFrameCapture() {
    stopFrameCapture();
    DOM.recChip.style.display = 'flex';

    state.captureInterval = setInterval(() => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        if (!DOM.videoFeed.videoWidth) return;

        const ctx = DOM.canvas.getContext('2d');
        ctx.drawImage(DOM.videoFeed, 0, 0);

        const dataUrl = DOM.canvas.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY);

        const message = JSON.stringify({ frame: dataUrl });
        state.ws.send(message);
    }, CONFIG.FRAME_INTERVAL_MS);

    // Start UI Scan Timer
    state.timeLeft = 20; // 20 seconds is a safer absolute max, otherwise old phones error out too early
    state.goodMeasurements = 0;
    state.totalMeasurements = 0;
    // Clear accumulation arrays
    ['allHR', 'allRR', 'allSys', 'allDia', 'allSpo2', 'allTemp', 'allHRV', 'allSDNN', 'allPNN50', 'allStress', 'allLFHF', 'allPI', 'allSympathetic', 'allParasympathetic', 'allPRQ', 'allWellness', 'allAge', 'allGender'].forEach(k => state[k] = []);

    if (DOM.timerChip) DOM.timerChip.style.display = 'flex';
    if (DOM.timerChip) DOM.timerChip.style.background = '#0ea5e9';
    if (DOM.timerText) DOM.timerText.textContent = `🔬 Step 1: Face Detection...`;
    updateMessage('Step 1: Detecting face and selecting Region of Interest (ROI)', 'info');
    state.scanPhase = 'face';

    let facePartIdx = 0;
    const faceParts = [
        '👁️ Checking Eye...',
        '👃 Checking Nose...',
        '👤 Checking Head...',
        '🧠 Checking Forehead...',
        '👄 Checking Mouth...',
        '👤 Scanning Full Face...'
    ];

    state.fastUIInterval = setInterval(() => {
        if (state.scanPhase === 'face') {
            if (DOM.timerText) DOM.timerText.textContent = faceParts[Math.min(facePartIdx, faceParts.length - 1)];
            facePartIdx++;
        } else {
            clearInterval(state.fastUIInterval);
            state.fastUIInterval = null;
        }
    }, 250); // fast 250ms interval to get through all parts in 1.5 seconds minimum

    state.scanTimerInterval = setInterval(() => {
        state.timeLeft--;

        if (state.timeLeft <= 0) {
            clearInterval(state.scanTimerInterval);
            if (DOM.timerText) DOM.timerText.textContent = `✅ Fetching Complete!`;
            if (DOM.timerChip) DOM.timerChip.style.background = '#059669';
            autoCompleteSession();
        } else {
            // If in vitals phase, show progress. Otherwise show seconds.
            if (state.scanPhase === 'vitals') {
                const progress = Math.min(100, (state.allHR.length / 15) * 100).toFixed(0);
                if (DOM.timerText) DOM.timerText.textContent = `💓 Fetching Vitals... ${progress}%`;
                if (DOM.timerChip) DOM.timerChip.style.background = '#0ea5e9';
            } else {
                if (DOM.timerText) DOM.timerText.textContent = `👤 Analyzing Face... ${state.timeLeft}s`;
            }
        }
    }, 1000);
}

function stopFrameCapture() {
    if (state.captureInterval) {
        clearInterval(state.captureInterval);
        state.captureInterval = null;
    }
    if (state.scanTimerInterval) {
        clearInterval(state.scanTimerInterval);
        state.scanTimerInterval = null;
    }
    if (state.fastUIInterval) {
        clearInterval(state.fastUIInterval);
        state.fastUIInterval = null;
    }
    DOM.recChip.style.display = 'none';
    if (DOM.timerChip) DOM.timerChip.style.display = 'none';
}

// ─── Session Control ──────────────────────────────────────────────────
async function startSession() {
    if (state.isRunning) return;

    DOM.btnStart.disabled = true;
    state.isRunning = true;

    const cameraOk = await initCamera();
    if (!cameraOk) {
        state.isRunning = false;
        DOM.btnStart.disabled = false;
        return;
    }

    DOM.startupOverlay.classList.add('hidden');
    connectWebSocket();
}

async function stopSession() {
    state.isRunning = false;
    stopFrameCapture();
    disconnectWebSocket();
    stopCamera();
    resetUI();

    DOM.startupOverlay.classList.remove('hidden');
    DOM.btnStart.disabled = false;
    updateMessage('Session ended.', 'info');
}

async function autoCompleteSession() {
    state.isRunning = false;
    stopFrameCapture();
    disconnectWebSocket();
    stopCamera();

    // Show results screen with final vitals
    showResultsScreen();
    updateMessage('✅ Scan complete! Your results are ready.', 'success');
}

// Helper: Compute median of an array
function median(arr) {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Enhanced accuracy check
 * Stops the scan only when signal is stable AND quality is high.
 */
function isDataAccurate(vitals, quality) {
    if (!vitals || !quality) return false;

    // Requirement 1: Minimum sample size for statistical significance
    if (state.allHR.length < 25) return false;

    // Requirement 2: High signal quality (SNR > 6dB or Excellent/Good level)
    const isQualityHigh = quality.is_acceptable && (quality.snr_db > 6 || quality.overall_level === 'EXCELLENT');
    if (!isQualityHigh) return false;

    // Requirement 3: Reading Stability (low variance in last 8 heart rate samples)
    const lastSamples = state.allHR.slice(-8);
    if (lastSamples.length < 8) return false;

    const mean = lastSamples.reduce((a, b) => a + b, 0) / lastSamples.length;
    const variance = lastSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lastSamples.length;
    const stdDev = Math.sqrt(variance);

    // Target: SD < 1.5 BPM (very stable)
    const stable = stdDev < 1.5;

    return stable && isQualityHigh;
}

function showResultsScreen() {
    const v = {
        heart_rate: median(state.allHR),
        respiratory_rate: median(state.allRR),
        blood_pressure_sys: median(state.allSys),
        blood_pressure_dia: median(state.allDia),
        spo2_estimate: median(state.allSpo2),
        skin_temp: median(state.allTemp),
        hrv_rmssd: median(state.allHRV),
        stress_index: median(state.allStress),
        sympathetic_activity: median(state.allSympathetic),
        parasympathetic_activity: median(state.allParasympathetic),
        wellness_score: median(state.allWellness),
        hemoglobin: median(state.allHemoglobin),
        glucose: median(state.allGlucose),
        hba1c: median(state.allHbA1c),
        hydration: median(state.allHydration),
        cardio_age: median(state.allCardioAge),
        vascular_health: median(state.allVascularHealth),
        cardiac_index: median(state.allCardiacIndex),
        htn_risk: state.allHypertensionRisk.length > 0 ? (counts => Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b))(state.allHypertensionRisk.reduce((acc, r) => ({ ...acc, [r]: (acc[r] || 0) + 1 }), {})) : 'Unknown'
    };

    if (!v.heart_rate && state.allHR.length === 0) {
        alert('No data was captured. Please try again with good lighting and stay completely still.');
        DOM.startupOverlay.classList.remove('hidden');
        DOM.btnStart.disabled = false;
        return;
    }

    const confidence = state.totalMeasurements > 0
        ? Math.round((state.goodMeasurements / state.totalMeasurements) * 100) : 0;

    function fmt(val, decimals = 0) {
        return (val !== null && val !== undefined) ? Number(val).toFixed(decimals) : '--';
    }

    function getHealthMetricInfo(val, label) {
        if (val === null || val === undefined) return { color: '#64748b', status: '' };
        switch (label) {
            case 'Heart Rate':
                if (val >= 60 && val <= 100) return { color: '#059669', status: 'Normal' };
                return { color: '#dc2626', status: val < 60 ? 'Bradycardia' : 'Tachycardia' };
            case 'Oxygen Saturation':
                if (val >= 95) return { color: '#059669', status: 'Optimal' };
                return { color: '#d97706', status: 'Low' };
            case 'Hemoglobin (Est)':
                if (val >= 13.5 && val <= 17.5) return { color: '#059669', status: 'Normal' };
                return { color: '#dc2626', status: 'Check' };
            case 'Wellness Quotient':
                if (val >= 7.5) return { color: '#059669', status: 'High' };
                return { color: '#dc2626', status: 'Low' };
            default: return { color: '#64748b', status: '' };
        }
    }

    const categories = [
        {
            title: "Vital Parameters",
            items: [
                { label: 'Heart Rate', value: fmt(v.heart_rate), unit: 'BPM' },
                { label: 'Respiratory Rate', value: fmt(v.respiratory_rate), unit: 'br/min' },
                { label: 'Blood Pressure', value: `${fmt(v.blood_pressure_sys)}/${fmt(v.blood_pressure_dia)}`, unit: 'mmHg' },
                { label: 'Oxygen Saturation', value: fmt(v.spo2_estimate), unit: '%' }
            ]
        },
        {
            title: "Internal Health Markers",
            items: [
                { label: 'Hemoglobin (Est)', value: fmt(v.hemoglobin, 1), unit: 'g/dL' },
                { label: 'Glucose Trend', value: fmt(v.glucose), unit: 'mg/dL' },
                { label: 'Skin Temp', value: fmt(v.skin_temp, 1), unit: '°F' },
                { label: 'Hydration', value: fmt(v.hydration, 1), unit: '/ 10' }
            ]
        },
        {
            title: "Cardiovascular Analysis",
            items: [
                { label: 'Cardio Age', value: v.cardio_age || '--', unit: 'Years' },
                { label: 'Vascular Health', value: fmt(v.vascular_health), unit: '%' },
                { label: 'Hypertension Risk', value: v.htn_risk, unit: '' },
                { label: 'Cardiac Index', value: fmt(v.cardiac_index, 2), unit: 'L/min/m²' }
            ]
        }
    ];

    const confidenceColor = confidence >= 80 ? '#059669' : (confidence >= 50 ? '#d97706' : '#dc2626');
    const estimatedAge = median(state.allAge);
    const genderCounts = {};
    state.allGender.forEach(g => { genderCounts[g] = (genderCounts[g] || 0) + 1; });
    const estimatedGender = Object.keys(genderCounts).sort((a, b) => genderCounts[b] - genderCounts[a])[0] || 'Unknown';

    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    let docHTML = `
        <div class="results-header">
            <div>
                <h2>Physiological Profile</h2>
                <div class="results-subtitle">AI-Driven Vital Sign Assessment</div>
            </div>
            <div class="report-metadata">
                <div><strong>Ref:</strong> TG-${state.sessionId.toUpperCase()}</div>
                <div><strong>Date:</strong> ${dateStr}</div>
                <div><strong>Time:</strong> ${timeStr}</div>
            </div>
        </div>

        <div class="results-hero-strip">
            <div class="hero-strip-item">
                <div class="hero-strip-label">Subject Gender</div>
                <div class="hero-strip-value">${estimatedGender}</div>
            </div>
            <div style="width: 1px; background: #e2e8f0;"></div>
            <div class="hero-strip-item">
                <div class="hero-strip-label">Clinical Age Est.</div>
                <div class="hero-strip-value">${estimatedAge || '--'} yrs</div>
            </div>
            <div style="width: 1px; background: #e2e8f0;"></div>
            <div class="hero-strip-item">
                <div class="hero-strip-label">Data Fidelity</div>
                <div class="hero-strip-value" style="color: ${confidenceColor}">${confidence}%</div>
            </div>
        </div>

        <div id="resultsGrid">
    `;

    categories.forEach(cat => {
        docHTML += `
            <div class="report-category-group">
                <div class="report-category-title">${cat.title}</div>
                <div class="report-metric-grid">
        `;
        cat.items.forEach(item => {
            const numVal = item.value === '--' || item.value.includes('/') ? null : parseFloat(item.value);
            const info = getHealthMetricInfo(numVal, item.label);
            docHTML += `
                <div class="report-metric-item">
                    <div class="metric-info-col">
                        <span class="metric-label">${item.label}</span>
                        <div class="metric-value-row">
                            <span class="metric-value">${item.value}</span>
                            <span class="metric-unit">${item.unit}</span>
                        </div>
                    </div>
                    ${info.status ? `<span class="metric-status-badge" style="background: ${info.color}15; color: ${info.color};">${info.status}</span>` : ''}
                </div>
            `;
        });
        docHTML += `</div></div>`;
    });

    docHTML += `</div>`;
    DOM.resultsGrid.innerHTML = docHTML;
    DOM.resultsOverlay.classList.add('visible');

    // Attach print handler
    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) {
        btnPrint.onclick = () => window.print();
    }
}

function resetSession() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ command: 'reset' }));
    }

    // Clear local state
    state.hrHistory = [];
    state.rrHistory = [];
    state.hrvHistory = [];
    state.spo2History = [];
    state.signalData = [];
    state.spectrumData = [];
    state.spectrumFreqs = [];

    resetVitalsDisplay();
    updateMessage('🔄 Buffers reset. Collecting new data...', 'info');
}

// ─── Measurement Handler ─────────────────────────────────────────────
function handleMeasurement(data) {
    const result = data; // Renamed 'data' to 'result' for consistency with the new code structure

    // 1. Handling Message Bar Feedback
    if (result.message) {
        DOM.messageText.textContent = result.message;

        // Visual feedback for scanning phase
        if (result.message.includes("Scanning Face")) {
            DOM.messageBar.style.background = "linear-gradient(90deg, #1e293b, #334155)";
            DOM.messageBar.style.borderColor = "#3b82f6";
        } else if (result.message.includes("Too much movement")) {
            DOM.messageBar.style.background = "linear-gradient(90deg, #450a0a, #7f1d1d)";
            DOM.messageBar.style.borderColor = "#ef4444";
        } else {
            DOM.messageBar.style.background = "var(--glass-bg)";
            DOM.messageBar.style.borderColor = "var(--glass-border)";
        }
    }

    // 2. Face Rectangle Overlay
    if (result.face_rect) {
        const [x, y, w, h] = result.face_rect;
        drawFaceOverlay(x, y, w, h);
    } else {
        // Clear face overlay if no face is detected
        clearFaceOverlay();
    }

    // Face detection state (moved from original position)
    DOM.videoWrapper.classList.toggle('face-detected', result.face_detected);
    DOM.videoWrapper.classList.toggle('no-face', !result.face_detected);

    if (DOM.faceGuideText) {
        if (result.face_detected) {
            DOM.faceGuideText.textContent = "Face Detected - Hold Still";
        } else {
            DOM.faceGuideText.textContent = "Please put your face within the frame";
        }
    }

    // 3. Status Badge Updates
    if (result.quality) {
        DOM.qualityChipText.textContent = `Quality: ${result.quality.overall_level.toUpperCase()}`;
        const colors = { EXCELLENT: '#059669', GOOD: '#10b981', FAIR: '#d97706', POOR: '#dc2626', REJECTED: '#7f1d1d' };
        DOM.qualityChip.style.background = colors[result.quality.overall_level.toUpperCase()] || '#1e293b';
    }

    // 4. Progress Tracking
    if (result.buffer_fill !== undefined) {
        DOM.bufferFill.style.width = `${result.buffer_fill}%`;
        DOM.bufferLabel.textContent = `Buffer: ${Math.round(result.buffer_fill)}%`;
    }

    // FPS (moved from original position)
    if (result.fps_actual) {
        DOM.fpsBadge.textContent = `${result.fps_actual} FPS`;
    }

    // 5. Update Vitals if Scanning is complete
    // The original updateVitals function is called here, but with the new condition
    if (result.vitals && !result.message.includes("Scanning Face")) {
        updateVitals(result.vitals);
    }

    // Accumulate ALL vitals for median computation at end (only during the 'vitals' phase)
    // Removed strict 'quality.acceptable' filter here so we always collect data.
    // The median function at the end handles noise and outliers perfectly.
    if (state.scanPhase === 'vitals' && data.vitals) {
        state.totalMeasurements++;
        if (data.quality && data.quality.acceptable) {
            state.goodMeasurements++;
        }

        const v = data.vitals;
        if (v.heart_rate) state.allHR.push(v.heart_rate);
        if (v.respiratory_rate) state.allRR.push(v.respiratory_rate);
        if (v.blood_pressure_sys) state.allSys.push(v.blood_pressure_sys);
        if (v.blood_pressure_dia) state.allDia.push(v.blood_pressure_dia);
        if (v.spo2_estimate) state.allSpo2.push(v.spo2_estimate);
        if (v.skin_temp) state.allTemp.push(v.skin_temp);
        if (v.hrv_rmssd != null) state.allHRV.push(v.hrv_rmssd);
        if (v.hrv_sdnn != null) state.allSDNN.push(v.hrv_sdnn);
        if (v.hrv_pnn50 != null) state.allPNN50.push(v.hrv_pnn50);
        if (v.stress_index != null) state.allStress.push(v.stress_index);
        if (v.lf_hf_ratio != null) state.allLFHF.push(v.lf_hf_ratio);
        if (v.perfusion_index != null) state.allPI.push(v.perfusion_index);
        if (v.sympathetic_activity != null) state.allSympathetic.push(v.sympathetic_activity);
        if (v.parasympathetic_activity != null) state.allParasympathetic.push(v.parasympathetic_activity);
        if (v.prq != null) state.allPRQ.push(v.prq);
        if (v.wellness_score != null) state.allWellness.push(v.wellness_score);

        // Advanced AI Proxies
        if (v.hemoglobin != null) state.allHemoglobin.push(v.hemoglobin);
        if (v.blood_glucose != null) state.allGlucose.push(v.blood_glucose);
        if (v.hba1c != null) state.allHbA1c.push(v.hba1c);
        if (v.hydration_index != null) state.allHydration.push(v.hydration_index);
        if (v.cardio_age != null) state.allCardioAge.push(v.cardio_age);
        if (v.vascular_health != null) state.allVascularHealth.push(v.vascular_health);
        if (v.hypertension_risk != null) state.allHypertensionRisk.push(v.hypertension_risk);
        if (v.cardiac_index != null) state.allCardiacIndex.push(v.cardiac_index);

        // ACCURACY-BASED COMPLETION -> Stop when we have stable, high-quality data
        if (state.isRunning && isDataAccurate(v, data.quality)) {
            if (DOM.timerText) DOM.timerText.textContent = `✨ Accuracy Target Reached!`;
            if (DOM.timerChip) DOM.timerChip.style.background = '#059669';
            autoCompleteSession();
        }
    } else if (data.vitals) {
        state.totalMeasurements++;
    }

    // Phase Switching updates for the UI
    // Don't wait for 90% buffer fill! Transition visually the moment we have ANY vitals object.
    if (state.scanPhase === 'face' && data.vitals && data.buffer_fill >= 10) {
        state.scanPhase = 'vitals';
        updateMessage('💓 Sensors locked! Extracting vitals from face...', 'info');
    }

    // Age & Gender estimation — accumulate regardless of quality
    if (data.estimated_age) {
        state.allAge.push(data.estimated_age);
    }
    if (data.estimated_gender) {
        state.allGender.push(data.estimated_gender);
    }
    // Show face info on video
    if (state.scanPhase === 'face' || state.allAge.length > 0) {
        showFaceInfoOnVideo(data.estimated_age || median(state.allAge), data.estimated_gender || state.allGender[state.allGender.length - 1]);
    }

    // Quality
    updateQuality(data.quality);

    // Charts
    if (data.raw_signal && data.raw_signal.length > 0) {
        state.signalData = data.raw_signal;
        drawSignalChart();
    }

    if (data.spectrum && data.spectrum.length > 0) {
        state.spectrumData = data.spectrum;
        state.spectrumFreqs = data.spectrum_freqs;
        drawSpectrumChart();
    }
}

// ─── Vital Signs Display ─────────────────────────────────────────────
function updateVitals(vitals) {
    if (!vitals) return;

    // Heart Rate
    if (vitals.heart_rate !== null && DOM.hrValue) {
        DOM.hrValue.textContent = vitals.heart_rate.toFixed(0);
        DOM.hrValue.classList.remove('inactive');
        state.hrHistory.push(vitals.heart_rate);
        if (state.hrHistory.length > CONFIG.SPARKLINE_MAX_POINTS) state.hrHistory.shift();
        drawSparkline(DOM.sparklineHR, state.hrHistory, CONFIG.COLORS.heart, CONFIG.COLORS.heartDim);
        updateHeartbeatSpeed(vitals.heart_rate);
    }

    // Respiratory Rate
    if (vitals.respiratory_rate !== null && DOM.rrValue) {
        DOM.rrValue.textContent = vitals.respiratory_rate.toFixed(0);
        DOM.rrValue.classList.remove('inactive');
        state.rrHistory.push(vitals.respiratory_rate);
        if (state.rrHistory.length > CONFIG.SPARKLINE_MAX_POINTS) state.rrHistory.shift();
        drawSparkline(DOM.sparklineRR, state.rrHistory, CONFIG.COLORS.breath, CONFIG.COLORS.breathDim);
    }

    // HRV (RMSSD, SDNN, pNN50)
    if (vitals.hrv_rmssd !== null && DOM.hrvValue) {
        DOM.hrvValue.textContent = vitals.hrv_rmssd.toFixed(0);
        DOM.hrvValue.classList.remove('inactive');
        if (vitals.hrv_sdnn !== null && DOM.sdnnValue) DOM.sdnnValue.textContent = vitals.hrv_sdnn.toFixed(0);
        if (vitals.hrv_pnn50 !== null && DOM.pnn50Value) DOM.pnn50Value.textContent = vitals.hrv_pnn50.toFixed(0) + '%';
    }

    // SpO2
    const spo2El = document.getElementById('spo2Value');
    if (vitals.spo2_estimate !== null && spo2El) {
        spo2El.textContent = vitals.spo2_estimate.toFixed(0);
        spo2El.classList.remove('inactive');
    }

    // Blood Pressure
    const bpEl = document.getElementById('bpValue');
    if (vitals.blood_pressure_sys && vitals.blood_pressure_dia && bpEl) {
        bpEl.textContent = `${vitals.blood_pressure_sys.toFixed(0)}/${vitals.blood_pressure_dia.toFixed(0)}`;
        bpEl.classList.remove('inactive');
        const sysEl = document.getElementById('sysValue');
        const diaEl = document.getElementById('diaValue');
        if (sysEl) sysEl.textContent = vitals.blood_pressure_sys.toFixed(0);
        if (diaEl) diaEl.textContent = vitals.blood_pressure_dia.toFixed(0);
    }

    // Stress & ANS
    const stressEl = document.getElementById('stressValue');
    if (vitals.stress_index !== null && stressEl) {
        stressEl.textContent = vitals.stress_index.toFixed(0);
        stressEl.classList.remove('inactive');
        stressEl.style.color = vitals.stress_index > 500 ? CONFIG.COLORS.qualityPoor :
            (vitals.stress_index > 150 ? CONFIG.COLORS.qualityFair : CONFIG.COLORS.qualityExcellent);
    }

    const lfhfEl = document.getElementById('lfhfValue');
    const balanceEl = document.getElementById('balanceStatus');
    if (vitals.lf_hf_ratio !== null && lfhfEl) {
        lfhfEl.textContent = vitals.lf_hf_ratio.toFixed(2);
        if (balanceEl) {
            if (vitals.lf_hf_ratio > 2.0) {
                balanceEl.textContent = 'Sympathetic';
                balanceEl.style.color = '#f87171';
            } else if (vitals.lf_hf_ratio < 0.5) {
                balanceEl.textContent = 'Parasymp.';
                balanceEl.style.color = '#60a5fa';
            } else {
                balanceEl.textContent = 'Balanced';
                balanceEl.style.color = '#10b981';
            }
        }
    }

    // Wellness (Temp & Perfusion)
    const tempEl = document.getElementById('tempValue');
    const piEl = document.getElementById('piValue');
    if (vitals.skin_temp && tempEl) {
        tempEl.textContent = vitals.skin_temp.toFixed(1);
        tempEl.classList.remove('inactive');
    }
    if (vitals.perfusion_index && piEl) piEl.textContent = vitals.perfusion_index.toFixed(1);

    // Sympathetic Activity
    const sympEl = document.getElementById('sympatheticValue');
    if (vitals.sympathetic_activity !== null && vitals.sympathetic_activity !== undefined && sympEl) {
        sympEl.textContent = vitals.sympathetic_activity.toFixed(0);
        sympEl.classList.remove('inactive');
    }

    // Parasympathetic Activity
    const parasympEl = document.getElementById('parasympatheticValue');
    if (vitals.parasympathetic_activity !== null && vitals.parasympathetic_activity !== undefined && parasympEl) {
        parasympEl.textContent = vitals.parasympathetic_activity.toFixed(0);
        parasympEl.classList.remove('inactive');
    }

    // PRQ
    const prqEl = document.getElementById('prqValue');
    if (vitals.prq !== null && vitals.prq !== undefined && prqEl) {
        prqEl.textContent = vitals.prq.toFixed(1);
        prqEl.classList.remove('inactive');
    }

    // Wellness Score
    const wellnessEl = document.getElementById('wellnessValue');
    if (vitals.wellness_score !== null && vitals.wellness_score !== undefined && wellnessEl) {
        wellnessEl.textContent = vitals.wellness_score.toFixed(1);
        wellnessEl.classList.remove('inactive');
        wellnessEl.style.color = vitals.wellness_score >= 7 ? '#34d399' :
            (vitals.wellness_score >= 4 ? '#fbbf24' : '#ef4444');
    }
}

function resetVitalsDisplay() {
    const ids = ['hrValue', 'rrValue', 'hrvValue', 'spo2Value', 'bpValue', 'stressValue', 'sysValue', 'diaValue', 'lfhfValue', 'tempValue', 'piValue', 'sdnnValue', 'pnn50Value', 'sympatheticValue', 'parasympatheticValue', 'prqValue', 'wellnessValue'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '--';
            if (el.classList.contains('vital-value')) el.classList.add('inactive');
        }
    });
    const balanceEl = document.getElementById('balanceStatus');
    if (balanceEl) balanceEl.textContent = '--';
}

function updateHeartbeatSpeed(bpm) {
    const period = 60 / bpm;
    document.querySelectorAll('.heartbeat-icon').forEach(el => {
        el.style.animationDuration = `${period}s`;
    });
}

// ─── Face Info Display on Video ──────────────────────────────────────
function showFaceInfoOnVideo(age, gender) {
    let badge = document.getElementById('ageBadge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'ageBadge';
        badge.style.cssText = `
            position: absolute; top: 12px; left: 12px; z-index: 20;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
            color: white; padding: 8px 14px; border-radius: 12px;
            font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;
            font-weight: 700; transition: all 0.3s ease;
            border: 1px solid rgba(255,255,255,0.15);
            display: flex; flex-direction: column; gap: 2px;
        `;
        DOM.videoWrapper.appendChild(badge);
    }
    const genderIcon = gender === 'Male' ? '♂️' : gender === 'Female' ? '♀️' : '';
    const ageText = age ? `~${age} yrs` : '...';
    const genderText = gender || '...';
    badge.innerHTML = `
        <span style="font-size: 0.75rem; opacity: 0.7;">FACE SCAN</span>
        <span>👤 ${ageText} · ${genderIcon} ${genderText}</span>
    `;
}


// ─── Signal Quality Display ──────────────────────────────────────────
function updateQuality(quality) {
    if (!quality) return;

    const circumference = 2 * Math.PI * 28; // r=28

    // SNR ring (0-10 dB scale)
    const snrPct = Math.min(Math.max(quality.snr_db / 10, 0), 1);
    updateRing(DOM.ringSnrFg, snrPct, getQualityColor(snrPct));
    DOM.snrValue.textContent = quality.snr_db.toFixed(1);

    // Spectral purity (0-1 scale)
    updateRing(DOM.ringSpectralFg, quality.spectral_purity, getQualityColor(quality.spectral_purity));
    DOM.spectralValue.textContent = (quality.spectral_purity * 100).toFixed(0);

    // Motion (inverse — lower is better, 0-30 scale)
    const motionPct = Math.max(0, 1 - quality.motion_score / 30);
    updateRing(DOM.ringMotionFg, motionPct, getQualityColor(motionPct));
    DOM.motionValue.textContent = quality.motion_score.toFixed(1);

    // Face confidence (0-1 scale)
    updateRing(DOM.ringFaceFg, quality.face_confidence, getQualityColor(quality.face_confidence));
    DOM.faceValue.textContent = (quality.face_confidence * 100).toFixed(0);

    // Overall level badge
    const level = quality.level || 'rejected';
    DOM.sqiLevelBadge.className = `quality-level-badge ${level}`;
    DOM.sqiLevelText.textContent = level.toUpperCase();

    // Video quality chip
    DOM.qualityChipText.textContent = `SQI: ${level}`;
}

function updateRing(element, percentage, color) {
    const circumference = 2 * Math.PI * 28;
    const offset = circumference * (1 - percentage);
    element.style.strokeDashoffset = offset;
    element.style.stroke = color;
}

function getQualityColor(value) {
    if (value >= 0.8) return CONFIG.COLORS.qualityExcellent;
    if (value >= 0.6) return CONFIG.COLORS.qualityGood;
    if (value >= 0.4) return CONFIG.COLORS.qualityFair;
    if (value >= 0.2) return CONFIG.COLORS.qualityPoor;
    return CONFIG.COLORS.qualityRejected;
}

// ─── Chart Drawing ────────────────────────────────────────────────────
function drawSignalChart() {
    const canvas = DOM.chartSignal;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const data = state.signalData;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    // Grid
    drawGrid(ctx, w, h);

    // Signal line
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 10;

    ctx.beginPath();
    ctx.strokeStyle = CONFIG.COLORS.signal;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Glow effect
    ctx.shadowColor = CONFIG.COLORS.signalGlow;
    ctx.shadowBlur = 8;

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = padding + (1 - (data[i] - min) / range) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill under curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawSpectrumChart() {
    const canvas = DOM.chartSpectrum;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const data = state.spectrumData;
    const freqs = state.spectrumFreqs;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    // Grid
    drawGrid(ctx, w, h);

    const max = Math.max(...data);
    const padding = 10;

    // Bars / area fill
    ctx.beginPath();
    ctx.strokeStyle = CONFIG.COLORS.spectrum;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const normalized = max > 0 ? data[i] / max : 0;
        const y = padding + (1 - normalized) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, CONFIG.COLORS.spectrumFill);
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Peak marker
    if (data.length > 0) {
        const peakIdx = data.indexOf(Math.max(...data));
        const peakX = (peakIdx / (data.length - 1)) * w;
        const peakY = padding;

        ctx.beginPath();
        ctx.arc(peakX, peakY + 4, 4, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.COLORS.spectrum;
        ctx.fill();

        // Label
        if (freqs.length > peakIdx) {
            const bpm = (freqs[peakIdx] * 60).toFixed(0);
            ctx.font = '11px JetBrains Mono, monospace';
            ctx.fillStyle = CONFIG.COLORS.spectrum;
            ctx.textAlign = 'center';
            ctx.fillText(`${bpm} BPM`, peakX, peakY - 4);
        }
    }
}

function drawGrid(ctx, w, h) {
    ctx.strokeStyle = CONFIG.COLORS.grid;
    ctx.lineWidth = 1;

    // Horizontal lines
    for (let i = 1; i < 4; i++) {
        const y = (i / 4) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Vertical lines
    for (let i = 1; i < 6; i++) {
        const x = (i / 6) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}

function drawSparkline(canvas, data, strokeColor, fillColor) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const min = Math.min(...data) - 2;
    const max = Math.max(...data) + 2;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = (1 - (data[i] - min) / range) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
}

// ─── Summary Modal ────────────────────────────────────────────────────
function showSummaryModal(summary) {
    const items = [
        { label: 'Duration', value: `${summary.duration_seconds?.toFixed(0) || 0}s` },
        { label: 'Total Frames', value: summary.total_frames || 0 },
        { label: 'Accepted', value: summary.accepted_measurements || 0 },
        { label: 'Rejected', value: summary.rejected_measurements || 0 },
        { label: 'Avg HR', value: summary.average_vitals?.heart_rate ? `${summary.average_vitals.heart_rate} BPM` : 'N/A' },
        { label: 'Avg RR', value: summary.average_vitals?.respiratory_rate ? `${summary.average_vitals.respiratory_rate} br/min` : 'N/A' },
        { label: 'Confidence', value: `${(summary.confidence_score * 100).toFixed(0)}%` },
        { label: 'EMR Ready', value: summary.emr_ready ? '✅ Yes' : '❌ No' },
    ];

    DOM.summaryGrid.innerHTML = items.map(item => `
        <div class="summary-item">
            <div class="summary-item-label">${item.label}</div>
            <div class="summary-item-value">${item.value}</div>
        </div>
    `).join('');

    DOM.summaryModal.classList.add('visible');
}

// ─── UI Helpers ───────────────────────────────────────────────────────
function updateMessage(text, type = 'info') {
    const icons = {
        info: 'ℹ️',
        success: '✅',
        error: '❌',
        warning: '⚠️',
    };
    DOM.messageText.textContent = text;
    DOM.messageBar.querySelector('.icon').textContent = icons[type] || 'ℹ️';
}

function resetUI() {
    DOM.videoWrapper.classList.remove('face-detected', 'no-face');
    DOM.bufferFill.style.width = '0%';
    DOM.bufferLabel.textContent = 'Buffer: 0%';
    DOM.fpsBadge.textContent = '0 FPS';
    DOM.qualityChipText.textContent = '—';
    DOM.sqiLevelBadge.className = 'quality-level-badge rejected';
    DOM.sqiLevelText.textContent = 'WAITING';
    resetVitalsDisplay();

    // Reset quality rings
    [DOM.ringSnrFg, DOM.ringSpectralFg, DOM.ringMotionFg, DOM.ringFaceFg].forEach(el => {
        el.style.strokeDashoffset = '175.93';
        el.style.stroke = CONFIG.COLORS.qualityRejected;
    });
    [DOM.snrValue, DOM.spectralValue, DOM.motionValue, DOM.faceValue].forEach(el => {
        el.textContent = '0';
    });

    // Clear charts
    [DOM.chartSignal, DOM.chartSpectrum, DOM.sparklineHR, DOM.sparklineRR].forEach(canvas => {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    });

    // Clear state history
    state.hrHistory = [];
    state.rrHistory = [];
    state.hrvHistory = [];
    state.spo2History = [];
    state.signalData = [];
    state.spectrumData = [];
    state.spectrumFreqs = [];
}

// ─── Utilities ────────────────────────────────────────────────────────
function generateSessionId() {
    return Math.random().toString(36).substring(2, 10);
}
