import React from 'react';

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
];

const StartupOverlay: React.FC<StartupOverlayProps> = ({
    hidden,
    loading,
    onStart,
}) => {
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
                    onClick={onStart}
                    disabled={loading}
                    aria-busy={loading}
                    aria-label={loading ? 'Initializing camera…' : 'Start 40-second scan'}
                >
                    {loading ? '🔓 Requesting Camera…' : '🫀 Start Scan (40 seconds)'}
                </button>

                <p className="startup-disclaimer">
                    Camera only · Video never leaves your device · Not for clinical diagnosis
                </p>
            </div>
        </div>
    );
};

export default StartupOverlay;
