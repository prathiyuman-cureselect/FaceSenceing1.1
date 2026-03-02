import React from 'react';

interface TopNavProps {
    fps: number;
    connected: boolean;
    sessionId: string | null;
}

const TopNav: React.FC<TopNavProps> = ({ fps, connected, sessionId }) => {
    return (
        <nav className="top-bar" role="navigation" aria-label="Application toolbar">
            <div className="brand">
                <div className="brand-icon" aria-hidden="true">
                    <span className="heartbeat-icon">🫀</span>
                </div>
                <div>
                    <h1>TeleGaruda AI</h1>
                    <span className="brand-subtitle">Clinical Dashboard v2.0</span>
                </div>
            </div>

            <div className="top-bar-right">
                <div
                    className="fps-badge"
                    role="status"
                    aria-label={`Frames per second: ${fps}`}
                >
                    {fps} FPS
                </div>

                <div className="session-badge" role="status">
                    <span
                        className={`session-dot ${connected ? 'active' : ''}`}
                        aria-hidden="true"
                    />
                    <span>
                        {connected
                            ? sessionId
                                ? `Session: ${sessionId}`
                                : 'Connecting...'
                            : 'Disconnected'}
                    </span>
                </div>
            </div>
        </nav>
    );
};

export default TopNav;
