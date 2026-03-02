import React, { memo, useEffect, useRef, useMemo, useCallback } from 'react';
import { drawFaceOverlay } from '../utils/canvas';

interface VideoSectionProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    isRunning: boolean;
    faceDetected: boolean;
    faceRect: [number, number, number, number] | null;
    bufferFill: number;
    timerText: string;
    qualityText: string;
    estimatedAge: number | null;
    estimatedGender: string | null;
    estimatedSentiment: string | null;
    onStop: () => void;
    onReset: () => void;
}

const VideoSection: React.FC<VideoSectionProps> = memo(({
    videoRef,
    canvasRef,
    isRunning,
    faceDetected,
    faceRect,
    bufferFill,
    timerText,
    qualityText,
    estimatedAge,
    estimatedGender,
    estimatedSentiment,
    onStop,
    onReset,
}) => {
    const svgRef = useRef<SVGSVGElement | null>(null);

    // Draw face overlay when face rect changes
    useEffect(() => {
        if (!svgRef.current) return;
        if (faceRect) {
            const [x, y, w, h] = faceRect;
            drawFaceOverlay(svgRef.current, x, y, w, h);
        } else {
            svgRef.current.innerHTML = '';
        }
    }, [faceRect]);

    const wrapperClass = useMemo(() => {
        const base = 'video-wrapper';
        if (faceDetected) return `${base} face-detected`;
        if (isRunning) return `${base} no-face`;
        return base;
    }, [faceDetected, isRunning]);

    const genderIcon = useMemo(() => {
        if (estimatedGender === 'Male') return '♂️';
        if (estimatedGender === 'Female') return '♀️';
        return '';
    }, [estimatedGender]);

    const sentimentEmoji = useMemo(() => {
        switch (estimatedSentiment) {
            case 'Smiling': return '😊';
            case 'Sad': return '😟';
            case 'Surprised': return '😲';
            case 'Focused': return '🧠';
            default: return '😐';
        }
    }, [estimatedSentiment]);

    const clampedBufferFill = useMemo(
        () => Math.max(0, Math.min(100, bufferFill)),
        [bufferFill],
    );

    const handleStop = useCallback(() => onStop(), [onStop]);
    const handleReset = useCallback(() => onReset(), [onReset]);

    return (
        <section className="card video-section" aria-label="Live camera feed">
            <div className="card-header">
                <span className="card-title">
                    <span aria-hidden="true">📹</span> Live Camera Feed
                </span>
                <div className="controls">
                    <button
                        className="btn btn-ghost"
                        id="btnReset"
                        onClick={handleReset}
                        title="Reset signal buffers"
                        aria-label="Reset signal buffers"
                    >
                        ↻ Reset
                    </button>
                    <button
                        className="btn btn-danger"
                        id="btnStop"
                        onClick={handleStop}
                        title="Stop analysis"
                        aria-label="Stop analysis"
                    >
                        ⏹ Stop
                    </button>
                </div>
            </div>

            <div className={wrapperClass}>
                {/* Video element */}
                <video
                    id="videoFeed"
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    aria-label="Camera feed"
                />

                {/* Hidden capture canvas */}
                <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />

                {/* Face SVG overlay */}
                <svg
                    ref={svgRef}
                    className="face-overlay-svg"
                    aria-hidden="true"
                />

                {/* Scanning Animation Components */}
                {isRunning && <div className="scanning-line" aria-hidden="true" />}
                <div className="face-lock-active" aria-hidden="true" />

                {/* Age / Gender badge */}
                {(estimatedAge || estimatedGender) && isRunning && (
                    <div className="age-badge" aria-label="Detected face info">
                        <span className="age-badge-sub">FACE SCAN</span>
                        <span>
                            👤 {estimatedAge ? `~${estimatedAge} yrs` : '...'} · {genderIcon}{' '}
                            {estimatedGender || '...'} · {sentimentEmoji} {estimatedSentiment || 'Neutral'}
                        </span>
                    </div>
                )}

                {/* Status chips */}
                <div className="video-status">
                    {isRunning && (
                        <div className="status-chip recording" role="status">
                            <span className="rec-dot" aria-hidden="true" />
                            ANALYZING
                        </div>
                    )}
                    {isRunning && timerText && (
                        <div className="status-chip timer" role="timer">
                            ⏱ {timerText}
                        </div>
                    )}
                    {qualityText && (
                        <div className="status-chip quality" role="status">
                            {qualityText}
                        </div>
                    )}
                    {faceDetected && isRunning && (
                        <div className="status-chip face-lock" style={{ background: 'var(--primary-color)', color: 'white' }}>
                            ⚡ SENSING...
                        </div>
                    )}
                </div>
            </div>

            {/* Buffer progress */}
            <div
                className="buffer-bar"
                role="progressbar"
                aria-valuenow={clampedBufferFill}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div className="buffer-fill" style={{ width: `${clampedBufferFill}%` }} />
            </div>
            <div className="buffer-label" aria-live="polite">
                Buffer: {Math.round(clampedBufferFill)}%
            </div>
        </section>
    );
});

VideoSection.displayName = 'VideoSection';

export default VideoSection;
