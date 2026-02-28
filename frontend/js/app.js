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
    FRAME_INTERVAL_MS: 50,       // 20 fps capture rate for higher pulse resolution
    JPEG_QUALITY: 0.6,             // Slightly lower quality to compensate for higher rate
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
    state.timeLeft = 35;
    state.goodMeasurements = 0;
    state.totalMeasurements = 0;
    // Clear accumulation arrays
    ['allHR', 'allRR', 'allSys', 'allDia', 'allSpo2', 'allTemp', 'allHRV', 'allSDNN', 'allPNN50', 'allStress', 'allLFHF', 'allPI', 'allSympathetic', 'allParasympathetic', 'allPRQ', 'allWellness', 'allAge', 'allGender'].forEach(k => state[k] = []);
    if (DOM.timerChip) DOM.timerChip.style.display = 'flex';
    if (DOM.timerChip) DOM.timerChip.style.background = '#7c3aed'; // Purple for face scan phase
    if (DOM.timerText) DOM.timerText.textContent = `👤 Scanning Face...`;
    state.scanPhase = 'face';
    updateMessage('📸 Phase 1: Scanning your face for age & gender...', 'info');

    state.scanTimerInterval = setInterval(() => {
        state.timeLeft--;

        if (state.timeLeft <= 0) {
            clearInterval(state.scanTimerInterval);
            if (DOM.timerText) DOM.timerText.textContent = `✅ Done!`;
            if (DOM.timerChip) DOM.timerChip.style.background = '#059669';
            autoCompleteSession();
        } else if (state.timeLeft <= 30 && state.scanPhase === 'face') {
            // Switch to vitals phase after 5 seconds
            state.scanPhase = 'vitals';
            if (DOM.timerChip) DOM.timerChip.style.background = '#0f172a';
            if (DOM.timerText) DOM.timerText.textContent = `💓 ${state.timeLeft}s · Sensing Vitals...`;
            updateMessage('💓 Phase 2: Sensing your vital signs — hold still!', 'info');
        } else if (state.scanPhase === 'vitals') {
            if (DOM.timerText) DOM.timerText.textContent = `💓 ${state.timeLeft}s · Sensing Vitals...`;
        } else {
            if (DOM.timerText) DOM.timerText.textContent = `👤 Scanning Face... ${state.timeLeft}s`;
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

function showResultsScreen() {
    // Compute median of all accumulated measurements
    function median(arr) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

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
        prq: median(state.allPRQ),
        wellness_score: median(state.allWellness),
    };

    if (!v.heart_rate && state.allHR.length === 0) {
        alert('No data was captured. Please try again with good lighting, stay completely still, and ensure your face is clearly visible.');
        DOM.startupOverlay.classList.remove('hidden');
        DOM.btnStart.disabled = false;
        return;
    }

    // Confidence score: % of measurements that were high quality
    const confidence = state.totalMeasurements > 0
        ? Math.round((state.goodMeasurements / state.totalMeasurements) * 100) : 0;

    function fmt(val, decimals = 0) {
        return (val !== null && val !== undefined) ? Number(val).toFixed(decimals) : '--';
    }
    function statusColor(val, low, high) {
        if (val === null || val === undefined) return '#64748b';
        if (val >= low && val <= high) return '#10b981';
        return '#ef4444';
    }
    function statusLabel(val, low, high) {
        if (val === null || val === undefined) return 'N/A';
        if (val >= low && val <= high) return 'Normal';
        if (val < low) return 'Low';
        return 'High';
    }

    const results = [
        { icon: '❤️', label: 'Heart Rate', value: fmt(v.heart_rate), unit: 'BPM', color: statusColor(v.heart_rate, 60, 100), status: statusLabel(v.heart_rate, 60, 100), samples: state.allHR.length },
        { icon: '🌬️', label: 'Breathing Rate', value: fmt(v.respiratory_rate), unit: 'br/min', color: statusColor(v.respiratory_rate, 12, 20), status: statusLabel(v.respiratory_rate, 12, 20), samples: state.allRR.length },
        { icon: '🩺', label: 'Blood Pressure', value: `${fmt(v.blood_pressure_sys)}/${fmt(v.blood_pressure_dia)}`, unit: 'mmHg', color: statusColor(v.blood_pressure_sys, 90, 140), status: statusLabel(v.blood_pressure_sys, 90, 140), samples: state.allSys.length },
        { icon: '🩸', label: 'SpO2', value: fmt(v.spo2_estimate), unit: '%', color: statusColor(v.spo2_estimate, 95, 100), status: statusLabel(v.spo2_estimate, 95, 100), samples: state.allSpo2.length },
        { icon: '🌡️', label: 'Temperature', value: fmt(v.skin_temp, 1), unit: '°F', color: statusColor(v.skin_temp, 97.0, 99.5), status: statusLabel(v.skin_temp, 97.0, 99.5), samples: state.allTemp.length },
        { icon: '📊', label: 'HRV (RMSSD)', value: fmt(v.hrv_rmssd), unit: 'ms', color: statusColor(v.hrv_rmssd, 20, 200), status: statusLabel(v.hrv_rmssd, 20, 200), samples: state.allHRV.length },
        { icon: '🧠', label: 'Stress Index', value: fmt(v.stress_index), unit: 'SI', color: statusColor(v.stress_index, 0, 500), status: v.stress_index > 500 ? 'High Stress' : (v.stress_index > 150 ? 'Moderate' : 'Relaxed'), samples: state.allStress.length },
        { icon: '⚡', label: 'Sympathetic', value: fmt(v.sympathetic_activity), unit: '%', color: '#f87171', status: '', samples: state.allSympathetic.length },
        { icon: '🧘', label: 'Parasympathetic', value: fmt(v.parasympathetic_activity), unit: '%', color: '#60a5fa', status: '', samples: state.allParasympathetic.length },
        { icon: '🔄', label: 'PRQ', value: fmt(v.prq, 1), unit: '', color: '#a78bfa', status: '', samples: state.allPRQ.length },
        { icon: '💚', label: 'Wellness', value: fmt(v.wellness_score, 1), unit: '/ 10', color: v.wellness_score >= 7 ? '#34d399' : (v.wellness_score >= 4 ? '#fbbf24' : '#ef4444'), status: v.wellness_score >= 7 ? 'Good' : (v.wellness_score >= 4 ? 'Fair' : 'Poor'), samples: state.allWellness.length },
    ];

    const confidenceColor = confidence >= 70 ? '#10b981' : (confidence >= 40 ? '#fbbf24' : '#ef4444');
    const confidenceLabel = confidence >= 70 ? 'HIGH' : (confidence >= 40 ? 'MEDIUM' : 'LOW');
    const estimatedAge = median(state.allAge);

    // Gender: use mode (most frequent value)
    const genderCounts = {};
    state.allGender.forEach(g => { genderCounts[g] = (genderCounts[g] || 0) + 1; });
    const estimatedGender = Object.keys(genderCounts).sort((a, b) => genderCounts[b] - genderCounts[a])[0] || null;
    const genderIcon = estimatedGender === 'Male' ? '♂️' : estimatedGender === 'Female' ? '♀️' : '❓';
    const genderColor = estimatedGender === 'Male' ? '#3b82f6' : '#ec4899';

    DOM.resultsGrid.innerHTML = `
        <div class="result-card" style="grid-column: 1 / -1; border-top: 3px solid #8b5cf6; background: linear-gradient(135deg, rgba(139,92,246,0.05), rgba(59,130,246,0.05));">
            <div style="display: flex; justify-content: center; align-items: center; gap: 32px; flex-wrap: wrap;">
                <div style="text-align: center;">
                    <div class="result-icon" style="font-size: 2.2rem;">👤</div>
                    <div class="result-label">Estimated Age</div>
                    <div class="result-value" style="color: #8b5cf6; font-size: 2.2rem;">~${estimatedAge ? estimatedAge : '--'}</div>
                    <div class="result-unit">years old</div>
                </div>
                <div style="width: 1px; height: 60px; background: rgba(0,0,0,0.1);"></div>
                <div style="text-align: center;">
                    <div class="result-icon" style="font-size: 2.2rem;">${genderIcon}</div>
                    <div class="result-label">Gender</div>
                    <div class="result-value" style="color: ${genderColor}; font-size: 2.2rem;">${estimatedGender || '--'}</div>
                    <div class="result-unit">${state.allGender.length} face samples</div>
                </div>
            </div>
        </div>
        <div class="result-card" style="grid-column: 1 / -1; border-top: 3px solid ${confidenceColor};">
            <div class="result-icon">🎯</div>
            <div class="result-label">Measurement Confidence</div>
            <div class="result-value" style="color: ${confidenceColor}">${confidence}%</div>
            <div class="result-unit">${confidenceLabel} · ${state.goodMeasurements} of ${state.totalMeasurements} frames accepted</div>
        </div>
    ` + results.map(r => `
        <div class="result-card">
            <div class="result-icon">${r.icon}</div>
            <div class="result-label">${r.label}</div>
            <div class="result-value" style="color: ${r.color}">${r.value}</div>
            <div class="result-unit">${r.unit}</div>
            ${r.status ? `<div class="result-status" style="color: ${r.color}">${r.status}</div>` : ''}
            <div class="result-samples">${r.samples} samples</div>
        </div>
    `).join('');

    DOM.resultsOverlay.classList.add('visible');
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
    // Face detection state
    DOM.videoWrapper.classList.toggle('face-detected', data.face_detected);
    DOM.videoWrapper.classList.toggle('no-face', !data.face_detected);

    if (DOM.faceGuideText) {
        if (data.face_detected) {
            DOM.faceGuideText.textContent = "Face Detected - Hold Still";
        } else {
            DOM.faceGuideText.textContent = "Please put your face within the frame";
        }
    }

    // Buffer progress
    DOM.bufferFill.style.width = `${data.buffer_fill}%`;
    DOM.bufferLabel.textContent = `Buffer: ${data.buffer_fill.toFixed(0)}%`;

    // FPS
    DOM.fpsBadge.textContent = `${data.fps_actual} FPS`;

    // Message
    if (data.message) {
        updateMessage(data.message);
    }

    // Vitals
    updateVitals(data.vitals);

    // Accumulate ALL vitals for median computation at end (only during the 'vitals' phase)
    if (state.scanPhase === 'vitals' && data.vitals && data.quality && data.quality.acceptable) {
        state.totalMeasurements++;
        state.goodMeasurements++;
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
    } else if (data.vitals) {
        state.totalMeasurements++;
    }

    // Age & Gender estimation — accumulate regardless of quality
    if (data.estimated_age) {
        state.allAge.push(data.estimated_age);
    }
    if (data.estimated_gender) {
        state.allGender.push(data.estimated_gender);
    }
    // Show face info on video
    showFaceInfoOnVideo(data.estimated_age, data.estimated_gender);

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
