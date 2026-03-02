import React, { memo, useCallback } from 'react';

interface StartupOverlayProps {
    hidden: boolean;
    loading: boolean;
    onStart: () => void;
}

const FEATURES = [
    'Heart Rate',
    'Blood Pressure',
    'SpO₂',
    'Temperature',
    'Stress',
    'Wellness',
    'HRV',
    'Hemoglobin',
] as const;

const StartupOverlay: React.FC<StartupOverlayProps> = memo(({
    hidden,
    loading,
    onStart,
}) => {
    const handleStart = useCallback(() => {
        if (!loading) onStart();
    }, [loading, onStart]);

    return (
        <div
            className={`startup-overlay ${hidden ? 'hidden' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="TeleGaruda AI — Clinical Dashboard"
        >
            <div className="startup-content">
                {/* Logo */}
                <div className="startup-logo-container">
                    <img
                        src="/asserts/Images/logo.png"
                        alt="TeleGaruda AI Logo"
                        className="startup-logo"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </div>

                <h2>TeleGaruda AI</h2>
                <p className="startup-subtitle">Contactless Vital Sign Analysis</p>

                <p>
                    AI-powered facial video analysis to measure your vitals in 40 seconds.
                    Sit still, face the camera, and let the AI scan your face.
                </p>

                {/* Feature chips */}
                <div className="startup-features" aria-label="Measured parameters">
                    {FEATURES.map((f) => (
                        <span key={f} className="feature-chip">
                            {f}
                        </span>
                    ))}
                </div>

                {/* Start button */}
                <button
                    className="btn btn-primary btn-start"
                    id="btnStart"
                    onClick={handleStart}
                    disabled={loading}
                    aria-busy={loading}
                    aria-label={loading ? 'Requesting camera access...' : 'Start 40-second scan'}
                >
                    {loading ? (
                        <>
                            <span className="spinner" aria-hidden="true">🔄</span>
                            Requesting Camera Access...
                        </>
                    ) : (
                        '🫀 Grant Permission to Start'
                    )}
                </button>

                <p className="startup-disclaimer">
                    Camera only · Video never leaves your device · Not for clinical diagnosis
                </p>
            </div>
        </div>
    );
});

StartupOverlay.displayName = 'StartupOverlay';

export default StartupOverlay;
