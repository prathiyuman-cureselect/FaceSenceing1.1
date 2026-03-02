import React, { memo, useMemo } from 'react';
import type { SignalQuality } from '../types';
import { getQualityColor } from '../utils/helpers';

interface QualitySectionProps {
    quality: SignalQuality | null;
}

const CIRCUMFERENCE = 2 * Math.PI * 28; // r=28

interface RingProps {
    label: string;
    unit: string;
    percentage: number;
    displayValue: string;
}

const QualityRing: React.FC<RingProps> = memo(({
    label,
    unit,
    percentage,
    displayValue,
}) => {
    const clampedPct = Math.min(Math.max(percentage, 0), 1);
    const offset = CIRCUMFERENCE * (1 - clampedPct);
    const color = getQualityColor(clampedPct);

    return (
        <div className="quality-meter">
            <div className="quality-meter-label">{label}</div>
            <div className="quality-ring" role="img" aria-label={`${label}: ${displayValue} ${unit}`}>
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <circle className="ring-bg" cx="32" cy="32" r="28" />
                    <circle
                        className="ring-fg"
                        cx="32"
                        cy="32"
                        r="28"
                        strokeDasharray={`${CIRCUMFERENCE}`}
                        strokeDashoffset={offset}
                        stroke={color}
                    />
                </svg>
                <div className="quality-ring-value">{displayValue}</div>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{unit}</div>
        </div>
    );
});

QualityRing.displayName = 'QualityRing';

const QualitySection: React.FC<QualitySectionProps> = memo(({ quality }) => {
    const { level, levelUpper, snrPct, spectralPct, motionPct, facePct } = useMemo(() => {
        const _level = quality?.level?.toLowerCase() ?? 'rejected';
        const _levelUpper = quality?.level?.toUpperCase() ?? 'WAITING';
        const _snrPct = quality ? Math.min(Math.max(quality.snr_db / 10, 0), 1) : 0;
        const _spectralPct = quality?.spectral_purity ?? 0;
        const _motionPct = quality ? Math.max(0, 1 - quality.motion_score / 30) : 0;
        const _facePct = quality?.face_confidence ?? 0;

        return {
            level: _level,
            levelUpper: _levelUpper,
            snrPct: _snrPct,
            spectralPct: _spectralPct,
            motionPct: _motionPct,
            facePct: _facePct,
        };
    }, [quality]);

    return (
        <section className="card quality-section" aria-label="Signal quality index">
            <div className="card-header">
                <span className="card-title">
                    <span aria-hidden="true">🛡️</span> Signal Quality Index
                </span>
                <span
                    className={`quality-level-badge ${level}`}
                    role="status"
                    aria-label={`Signal quality: ${levelUpper}`}
                >
                    {levelUpper}
                </span>
            </div>

            <div className="quality-meters">
                <QualityRing
                    label="SNR"
                    unit="dB"
                    percentage={snrPct}
                    displayValue={quality ? quality.snr_db.toFixed(1) : '0'}
                />
                <QualityRing
                    label="Spectral"
                    unit="purity"
                    percentage={spectralPct}
                    displayValue={quality ? (spectralPct * 100).toFixed(0) : '0'}
                />
                <QualityRing
                    label="Motion"
                    unit="score"
                    percentage={motionPct}
                    displayValue={quality ? quality.motion_score.toFixed(1) : '0'}
                />
                <QualityRing
                    label="Face"
                    unit="conf"
                    percentage={facePct}
                    displayValue={quality ? (facePct * 100).toFixed(0) : '0'}
                />
            </div>
        </section>
    );
});

QualitySection.displayName = 'QualitySection';

export default QualitySection;
