import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import TopNav from './components/TopNav';
import StartupOverlay from './components/StartupOverlay';
import MessageBar from './components/MessageBar';
import VideoSection from './components/VideoSection';
import VitalsGrid from './components/VitalsGrid';
import QualitySection from './components/QualitySection';
import ChartsSection from './components/ChartsSection';
import ResultsOverlay from './components/ResultsOverlay';

import { useCamera } from './hooks/useCamera';
import { useWebSocket } from './hooks/useWebSocket';
import { CONFIG } from './config/constants';
import {
  generateSessionId,
  median,
  isDataAccurate,
  getMostFrequentString,
} from './utils/helpers';

import type {
  ScanState,
  FinalResults,
  WSMessage,
  MeasurementData,
} from './types';

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = (): ScanState => ({
  isRunning: false,
  scanPhase: 'face',
  sessionId: null,
  timeLeft: CONFIG.SCAN_DURATION_SECONDS,
  bufferFill: 0,
  fps: 0,
  connected: false,
  message: 'Click "Start Scan" to begin vital sign analysis.',
  messageType: 'info',
  currentVitals: null,
  currentQuality: null,
  faceDetected: false,
  faceRect: null,
  estimatedAge: null,
  estimatedGender: null,
  estimatedSentiment: null,
  signalData: [],
  spectrumData: [],
  spectrumFreqs: [],
  hrHistory: [],
  rrHistory: [],
  allHR: [], allRR: [], allSys: [], allDia: [], allSpo2: [], allTemp: [],
  allHRV: [], allSDNN: [], allPNN50: [], allStress: [], allLFHF: [], allPI: [],
  allSympathetic: [], allParasympathetic: [], allPRQ: [], allWellness: [],
  allAge: [], allGender: [], allSentiment: [],
  allHemoglobin: [], allGlucose: [], allHbA1c: [], allHydration: [],
  allCardioAge: [], allVascularHealth: [], allHypertensionRisk: [], allCardiacIndex: [],
  goodMeasurements: 0,
  totalMeasurements: 0,
});

// ─── App Component ────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [scanState, setScanState] = useState<ScanState>(initialState);
  const [results, setResults] = useState<FinalResults | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [startupHidden, setStartupHidden] = useState(false);
  const [startupLoading, setStartupLoading] = useState(false);
  const [timerText, setTimerText] = useState('');
  const [qualityText, setQualityText] = useState('—');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fastUIRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const scanStateRef = useRef<ScanState>(scanState);
  scanStateRef.current = scanState;

  const { initCamera, stopCamera } = useCamera();

  // ─── WebSocket handlers ────────────────────────────────────────────────────

  const handleWsOpen = useCallback(() => {
    setScanState((prev) => ({
      ...prev,
      connected: true,
      message: '✅ Connected! Position your face and hold still.',
      messageType: 'success',
    }));
    startFrameCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWsClose = useCallback(() => {
    setScanState((prev) => ({
      ...prev,
      connected: false,
    }));
    stopFrameCapture();
  }, []);

  const handleWsMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'measurement' && msg.data) {
      handleMeasurement(msg.data);
    } else if (msg.type === 'error') {
      console.warn('Server error:', msg.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { send, wsRef } = useWebSocket({
    sessionId: scanState.sessionId,
    onMessage: handleWsMessage,
    onOpen: handleWsOpen,
    onClose: handleWsClose,
    isRunning: scanState.isRunning,
  });

  // ─── Measurement Handler ───────────────────────────────────────────────────

  const handleMeasurement = useCallback((data: MeasurementData) => {
    setScanState((prev) => {
      const next = { ...prev };

      // Message bar
      if (data.message) {
        next.message = data.message;
        next.messageType = 'info';
      }

      // Face detection
      next.faceDetected = data.face_detected;
      next.faceRect = data.face_rect;
      next.estimatedAge = data.estimated_age;
      next.estimatedGender = data.estimated_gender;
      next.estimatedSentiment = data.estimated_sentiment;

      // Quality chip text
      if (data.quality) {
        next.currentQuality = data.quality;
      }

      // Buffer fill + FPS
      next.bufferFill = data.buffer_fill;
      if (data.fps_actual) next.fps = data.fps_actual;

      // Phase switch: face → vitals
      if (next.scanPhase === 'face' && (data.message === 'PHASE_DETECTION_COMPLETE' || data.vitals)) {
        next.scanPhase = 'vitals';
        next.message = '⚡ Optical Lock Achieved. Sensing Physiological Signal...';
      }

      // Vitals display
      if (data.vitals && !data.message?.includes('Analyzing Face Profile')) {
        next.currentVitals = data.vitals;
      }

      // Charts
      if (data.signal?.length > 0) next.signalData = data.signal;
      if (data.spectrum?.length > 0) {
        next.spectrumData = data.spectrum;
        next.spectrumFreqs = data.spectrum_freqs;
      }

      // Heartbeat animation speed
      const hr = data.vitals?.heart_rate;
      if (hr && hr > 0) {
        document.querySelectorAll('.heartbeat-icon').forEach((el) => {
          (el as HTMLElement).style.animationDuration = `${60 / hr}s`;
        });
      }

      // Age / gender / sentiment accumulation
      if (data.estimated_age) next.allAge = [...next.allAge, data.estimated_age];
      if (data.estimated_gender) next.allGender = [...next.allGender, data.estimated_gender];
      if (data.estimated_sentiment) next.allSentiment = [...next.allSentiment, data.estimated_sentiment];

      // Accumulate vitals (Proactive capture: sensing starts as soon as backend has data)
      if (data.vitals) {
        next.totalMeasurements++;
        next.goodMeasurements++; // Count all successful extractions as 'good' for the report

        const v = data.vitals;
        const push = <T,>(arr: T[], val: T | null | undefined): T[] =>
          val !== null && val !== undefined ? [...arr, val] : arr;

        next.allHR = push(next.allHR, v.heart_rate);
        next.allRR = push(next.allRR, v.respiratory_rate);
        next.allSys = push(next.allSys, v.blood_pressure_sys);
        next.allDia = push(next.allDia, v.blood_pressure_dia);
        next.allSpo2 = push(next.allSpo2, v.spo2_estimate);
        next.allTemp = push(next.allTemp, v.skin_temp);
        next.allHRV = push(next.allHRV, v.hrv_rmssd);
        next.allSDNN = push(next.allSDNN, v.hrv_sdnn);
        next.allPNN50 = push(next.allPNN50, v.hrv_pnn50);
        next.allStress = push(next.allStress, v.stress_index);
        next.allLFHF = push(next.allLFHF, v.lf_hf_ratio);
        next.allPI = push(next.allPI, v.perfusion_index);
        next.allSympathetic = push(next.allSympathetic, v.sympathetic_activity);
        next.allParasympathetic = push(next.allParasympathetic, v.parasympathetic_activity);
        next.allPRQ = push(next.allPRQ, v.prq);
        next.allWellness = push(next.allWellness, v.wellness_score);
        next.allHemoglobin = push(next.allHemoglobin, v.hemoglobin);
        next.allGlucose = push(next.allGlucose, v.blood_glucose);
        next.allHbA1c = push(next.allHbA1c, v.hba1c);
        next.allHydration = push(next.allHydration, v.hydration_index);
        next.allCardioAge = push(next.allCardioAge, v.cardio_age);
        next.allVascularHealth = push(next.allVascularHealth, v.vascular_health);
        if (v.hypertension_risk) next.allHypertensionRisk = [...next.allHypertensionRisk, v.hypertension_risk];
        next.allCardiacIndex = push(next.allCardiacIndex, v.cardiac_index);

        // HR sparkline
        if (v.heart_rate !== null && v.heart_rate !== undefined) {
          next.hrHistory = [
            ...next.hrHistory,
            v.heart_rate,
          ].slice(-CONFIG.SPARKLINE_MAX_POINTS);
        }
        if (v.respiratory_rate !== null && v.respiratory_rate !== undefined) {
          next.rrHistory = [
            ...next.rrHistory,
            v.respiratory_rate,
          ].slice(-CONFIG.SPARKLINE_MAX_POINTS);
        }

        // Early accuracy-based completion
        if (
          next.isRunning &&
          data.quality &&
          isDataAccurate(next)
        ) {
          setTimerText('✨ Accuracy Target Reached!');
          // Trigger completion after this render
          setTimeout(() => autoCompleteSession(), 100);
        }
      }

      return next;
    });

    // Quality chip text
    if (data.quality) {
      setQualityText(`SQI: ${data.quality.level}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Frame Capture ─────────────────────────────────────────────────────────

  const startFrameCapture = useCallback(() => {
    stopFrameCapture();

    let facePartIdx = 0;
    const faceParts = [
      '👁️ Checking Eye...',
      '👃 Checking Nose...',
      '👤 Checking Head...',
      '🧠 Checking Forehead...',
      '👄 Checking Mouth...',
      '👤 Scanning Full Face...',
    ];

    setTimerText('🔬 Step 1: Face Detection...');

    fastUIRef.current = setInterval(() => {
      if (scanStateRef.current.scanPhase === 'face') {
        setTimerText(faceParts[Math.min(facePartIdx, faceParts.length - 1)]);
        facePartIdx++;
      } else {
        clearInterval(fastUIRef.current!);
        fastUIRef.current = null;
      }
    }, 250);

    let timeLeft = CONFIG.SCAN_DURATION_SECONDS;
    const totalDuration = CONFIG.SCAN_DURATION_SECONDS;
    const clinicalSteps = [
      'Locking Arterial Pulse...',
      'Analyzing Hemodynamics...',
      'SpO2 Oxygenation Scan...',
      'Computing HRV Metrics...',
      'Assessing Stress Index...',
      'Estimating Blood Markers...',
      'Skin Thermal Analysis...',
      'Finalizing Health Report...',
    ];

    scanTimerRef.current = setInterval(() => {
      timeLeft--;
      const elapsed = totalDuration - timeLeft;
      const progress = Math.min(100, (elapsed / totalDuration) * 100).toFixed(0);
      const stepIdx = Math.floor((elapsed / totalDuration) * clinicalSteps.length);
      const currentStep = clinicalSteps[Math.min(stepIdx, clinicalSteps.length - 1)];

      setScanState((prev) => ({ ...prev, timeLeft }));

      if (timeLeft <= 0) {
        console.log("Timer finished, calling autoCompleteSession");
        clearInterval(scanTimerRef.current!);
        scanTimerRef.current = null;
        setTimerText('✅ Scan Window Complete!');
        autoCompleteSession();
      } else {
        // Failsafe: if we've been scanning for >8s and still in 'face' phase, force 'vitals'
        if (scanStateRef.current.scanPhase === 'face' && elapsed > 8) {
          setScanState(prev => ({ ...prev, scanPhase: 'vitals' }));
        }

        if (scanStateRef.current.scanPhase === 'vitals') {
          setTimerText(`${currentStep} ${progress}%`);
        } else {
          setTimerText(scanStateRef.current.message || 'Analyzing Face Profile...');
        }
      }
    }, 1000);

    // Frame transmit interval
    captureIntervalRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;

      // Set canvas dimensions from video
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY);
      ws.send(JSON.stringify({ frame: dataUrl }));
    }, CONFIG.FRAME_INTERVAL_MS);
  }, [wsRef, videoRef, canvasRef]);

  const stopFrameCapture = useCallback(() => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (fastUIRef.current) {
      clearInterval(fastUIRef.current);
      fastUIRef.current = null;
    }
  }, []);

  // ─── Build Final Results ────────────────────────────────────────────────────

  const buildResults = useCallback((state: ScanState): FinalResults | null => {
    if (state.allHR.length === 0) return null;

    const confidence =
      state.totalMeasurements > 0
        ? Math.round((state.goodMeasurements / state.totalMeasurements) * 100)
        : 0;

    return {
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
      htn_risk: getMostFrequentString(state.allHypertensionRisk),
      estimatedAge: median(state.allAge),
      estimatedGender: getMostFrequentString(state.allGender),
      estimatedSentiment: getMostFrequentString(state.allSentiment),
      confidence,
      sessionId: state.sessionId ?? 'unknown',
    };
  }, []);

  // ─── Session Control ───────────────────────────────────────────────────────

  const autoCompleteSession = useCallback(() => {
    const currentState = scanStateRef.current;
    stopFrameCapture();

    const finalResults = buildResults(currentState);

    setScanState((prev) => ({
      ...prev,
      isRunning: false,
      message: '✅ Scan complete! Your results are ready.',
      messageType: 'success',
    }));

    stopCamera(activeStreamRef.current);
    activeStreamRef.current = null;

    // GUARANTEED REPORTING: Every 40-second scan now yields a result
    if (finalResults && (currentState.allHR.length > 0 || currentState.allAge.length > 0)) {
      setResults(finalResults);
      setShowResults(true);
    } else {
      const msg = "The biometric scanner failed to initialize properly. Please check your camera privacy settings and ensure your face is well-lit.";
      alert(`⚠️ SCAN ERROR\n\n${msg}`);
      setStartupHidden(false);
    }
  }, [stopFrameCapture, buildResults, stopCamera]);

  const startSession = useCallback(async () => {
    if (scanStateRef.current.isRunning) return;

    // Enforce HTTPS for non-localhost
    if (
      window.location.protocol === 'http:' &&
      window.location.hostname !== 'localhost'
    ) {
      const httpsUrl = window.location.href.replace('http:', 'https:');
      alert(
        '🛡️ SECURE CONTEXT REQUIRED\n\nTo access your camera, you MUST use the secure HTTPS link.\n\nRedirecting you now...',
      );
      window.location.href = httpsUrl;
      return;
    }

    setStartupLoading(true);

    try {
      const stream = await initCamera();
      if (!stream) throw new Error('Camera stream unavailable');

      activeStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', '');
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      const sid = generateSessionId();

      setScanState({
        ...initialState(),
        isRunning: true,
        sessionId: sid,
        scanPhase: 'face',
        message: '📸 Camera active. Connecting to server...',
        messageType: 'info',
      });

      setStartupHidden(true);
      setStartupLoading(false);
      setShowResults(false);
    } catch (err) {
      const error = err as Error;
      setStartupLoading(false);
      setScanState((prev) => ({
        ...prev,
        message: `❌ ${error.message}`,
        messageType: 'error',
      }));
      alert(
        `Camera Error: ${error.name ?? 'Error'} - ${error.message}\n\nTry refreshing or checking browser permissions.`,
      );
    }
  }, [initCamera]);

  const stopSession = useCallback(() => {
    stopFrameCapture();
    stopCamera(activeStreamRef.current);
    activeStreamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    setScanState((prev) => ({
      ...prev,
      isRunning: false,
      connected: false,
      sessionId: null,
      message: 'Session ended.',
      messageType: 'info',
    }));

    setStartupHidden(false);
  }, [stopFrameCapture, stopCamera]);

  const resetSession = useCallback(() => {
    send({ command: 'reset' });
    setScanState((prev) => ({
      ...prev,
      hrHistory: [],
      rrHistory: [],
      signalData: [],
      spectrumData: [],
      spectrumFreqs: [],
      currentVitals: null,
      message: '🔄 Buffers reset. Collecting new data...',
      messageType: 'info',
    }));
  }, [send]);

  const handleScanAgain = useCallback(() => {
    setShowResults(false);
    setStartupHidden(false);
    setScanState(initialState());
  }, []);

  // ─── Auto-start on mount ──────────────────────────────────────────────────

  useEffect(() => {
    // Small delay to ensure the UI has settled
    const timer = setTimeout(() => {
      startSession();
    }, 1000);
    return () => clearTimeout(timer);
  }, [startSession]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopFrameCapture();
      stopCamera(activeStreamRef.current);
    };
  }, [stopFrameCapture, stopCamera]);

  // ─── Derived state for display ─────────────────────────────────────────────

  const isScanning =
    scanState.isRunning && (scanState.scanPhase === 'face');

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Startup */}
      <StartupOverlay
        hidden={startupHidden}
        loading={startupLoading}
        onStart={startSession}
      />

      {/* Results */}
      <ResultsOverlay
        results={results}
        visible={showResults}
        onScanAgain={handleScanAgain}
      />

      {/* Top Navigation */}
      <TopNav
        fps={scanState.fps}
        connected={scanState.connected}
        sessionId={scanState.sessionId}
      />

      {/* Dashboard */}
      <main className="app-container" role="main">
        <MessageBar
          message={scanState.message}
          type={scanState.messageType}
        />

        <VideoSection
          videoRef={videoRef}
          canvasRef={canvasRef}
          isRunning={scanState.isRunning}
          faceDetected={scanState.faceDetected}
          bufferFill={scanState.bufferFill}
          timerText={timerText}
          qualityText={qualityText}
          estimatedAge={scanState.estimatedAge}
          estimatedGender={scanState.estimatedGender}
          estimatedSentiment={scanState.estimatedSentiment}
          onStop={stopSession}
          onReset={resetSession}
        />

        <VitalsGrid
          vitals={scanState.currentVitals}
          hrHistory={scanState.hrHistory}
          rrHistory={scanState.rrHistory}
          isScanning={isScanning}
        />

        <QualitySection quality={scanState.currentQuality} />

        <ChartsSection
          signalData={scanState.signalData}
          spectrumData={scanState.spectrumData}
          spectrumFreqs={scanState.spectrumFreqs}
        />
      </main>
    </>
  );
};

export default App;
