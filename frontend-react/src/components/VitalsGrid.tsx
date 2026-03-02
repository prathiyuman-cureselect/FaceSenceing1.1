import React, { useEffect, useRef } from 'react';
import type { VitalSigns } from '../types';
import { drawSparkline, resizeCanvas } from '../utils/canvas';
import { CONFIG } from '../config/constants';

interface VitalsGridProps {
    vitals: VitalSigns | null;
    hrHistory: number[];
    rrHistory: number[];
    isScanning: boolean;
}

// ─── Vital Card ───────────────────────────────────────────────────────────────

interface VitalCardProps {
    className: string;
    value: string;
    unit: string;
    label?: string;
    inactive?: boolean;
    children?: React.ReactNode;
}

const VitalCard: React.FC<VitalCardProps> = ({
    className,
    value,
    unit,
    label,
    inactive,
    children,
}) => (
    <div className={`vital-card ${className}`}>
        {label && <span className="vital-label">{label}</span>}
        <div className={`vital-value ${inactive ? 'inactive' : ''}`}>
            {value}
        </div>
        <span className="vital-unit">{unit}</span>
        {children}
    </div>
);

// ─── Main Grid ────────────────────────────────────────────────────────────────

const VitalsGrid: React.FC<VitalsGridProps> = ({
    vitals,
    hrHistory,
    rrHistory,
    isScanning,
}) => {
    const sparklineHRRef = useRef<HTMLCanvasElement>(null);
    const sparklineRRRef = useRef<HTMLCanvasElement>(null);

    // Resize sparklines
    useEffect(() => {
        const resize = () => {
            if (sparklineHRRef.current) resizeCanvas(sparklineHRRef.current, 36);
            if (sparklineRRRef.current) resizeCanvas(sparklineRRRef.current, 36);
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);

    // Draw sparklines
    useEffect(() => {
        if (sparklineHRRef.current && hrHistory.length > 1) {
            drawSparkline(
                sparklineHRRef.current,
                hrHistory,
                CONFIG.COLORS.heart,
                CONFIG.COLORS.heartDim,
            );
        }
    }, [hrHistory]);

    useEffect(() => {
        if (sparklineRRRef.current && rrHistory.length > 1) {
            drawSparkline(
                sparklineRRRef.current,
                rrHistory,
                CONFIG.COLORS.breath,
                CONFIG.COLORS.breathDim,
            );
        }
    }, [rrHistory]);

    // ─── Format helpers ────────────────────────────────────────────────────────
    const fmt = (val: number | null | undefined, dec = 0) =>
        val !== null && val !== undefined ? Number(val).toFixed(dec) : '--';

    const sensing = isScanning ? 'Sensing...' : undefined;
    const calibrating = isScanning ? 'Calibrating...' : undefined;

    const hr = vitals?.heart_rate;
    const rr = vitals?.respiratory_rate;
    const hrv = vitals?.hrv_rmssd;
    const sdnn = vitals?.hrv_sdnn;
    const pnn50 = vitals?.hrv_pnn50;
    const spo2 = vitals?.spo2_estimate;
    const sys = vitals?.blood_pressure_sys;
    const dia = vitals?.blood_pressure_dia;
    const temp = vitals?.skin_temp;
    const pi = vitals?.perfusion_index;
    const stress = vitals?.stress_index;
    const lfhf = vitals?.lf_hf_ratio;
    const symp = vitals?.sympathetic_activity;
    const parasymp = vitals?.parasympathetic_activity;
    const prq = vitals?.prq;
    const wellness = vitals?.wellness_score;

    const balanceText =
        lfhf !== null && lfhf !== undefined
            ? lfhf > 2.0
                ? 'Sympathetic'
                : lfhf < 0.5
                    ? 'Parasymp.'
                    : 'Balanced'
            : '--';

    const balanceColor =
        lfhf !== null && lfhf !== undefined
            ? lfhf > 2.0
                ? '#f87171'
                : lfhf < 0.5
                    ? '#60a5fa'
                    : '#10b981'
            : undefined;

    const wellnessColor =
        wellness !== null && wellness !== undefined
            ? wellness >= 7
                ? '#34d399'
                : wellness >= 4
                    ? '#fbbf24'
                    : '#ef4444'
            : undefined;

    const stressColor =
        stress !== null && stress !== undefined
            ? stress > 500
                ? '#ef4444'
                : stress > 150
                    ? '#f59e0b'
                    : '#10b981'
            : undefined;

    return (
        <section className="vitals-grid" aria-label="Vital signs">

            {/* Heart Rate */}
            <VitalCard
                className="hr"
                value={sensing ?? (hr !== null && hr !== undefined ? fmt(hr) : '--')}
                unit="BPM"
                inactive={isScanning || hr === null}
            >
                <div className="vital-sparkline">
                    <canvas ref={sparklineHRRef} width="200" height="36" aria-hidden="true" />
                </div>
            </VitalCard>

            {/* Respiratory Rate */}
            <VitalCard
                className="rr"
                value={sensing ?? (rr !== null && rr !== undefined ? fmt(rr) : '--')}
                unit="br/min"
                inactive={isScanning || rr === null}
            >
                <div className="vital-sparkline">
                    <canvas ref={sparklineRRRef} width="200" height="36" aria-hidden="true" />
                </div>
            </VitalCard>

            {/* Blood Pressure */}
            <VitalCard
                className="bp"
                value={
                    calibrating ??
                    (sys && dia ? `${fmt(sys)}/${fmt(dia)}` : '--')
                }
                unit="mmHg"
                inactive={isScanning || !sys}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label" style={{ color: '#ef4444' }}>SYS</div>
                        <div className="hrv-metric-value">{fmt(sys)}</div>
                    </div>
                    <div>
                        <div className="hrv-metric-label" style={{ color: '#fca5a5' }}>DIA</div>
                        <div className="hrv-metric-value">{fmt(dia)}</div>
                    </div>
                </div>
            </VitalCard>

            {/* SpO2 */}
            <VitalCard
                className="spo2"
                value={sensing ?? fmt(spo2)}
                unit="%"
                inactive={isScanning || spo2 === null}
            />

            {/* HRV */}
            <VitalCard
                className="hrv"
                value={isScanning ? '---' : fmt(hrv)}
                unit="ms"
                inactive={isScanning || hrv === null}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label">SDNN</div>
                        <div className="hrv-metric-value">{fmt(sdnn)}</div>
                    </div>
                    <div>
                        <div className="hrv-metric-label">pNN50</div>
                        <div className="hrv-metric-value">{fmt(pnn50)}</div>
                    </div>
                </div>
            </VitalCard>

            {/* Temperature */}
            <VitalCard
                className="temp"
                value={temp !== null && temp !== undefined ? fmt(temp, 1) : '--'}
                unit="°F"
                inactive={!temp}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label">Perfusion Idx</div>
                        <div className="hrv-metric-value">{pi !== null && pi !== undefined ? fmt(pi, 1) : '--'}</div>
                    </div>
                </div>
            </VitalCard>

            {/* Stress & ANS */}
            <VitalCard
                className="stress"
                value={stress !== null && stress !== undefined ? fmt(stress) : '--'}
                unit="Stress Index"
                inactive={stress === null}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label">LF/HF</div>
                        <div className="hrv-metric-value">
                            {lfhf !== null && lfhf !== undefined ? fmt(lfhf, 2) : '--'}
                        </div>
                    </div>
                    <div>
                        <div className="hrv-metric-label">ANS</div>
                        <div
                            className="hrv-metric-value"
                            style={{ fontSize: '0.6rem', color: balanceColor }}
                        >
                            {balanceText}
                        </div>
                    </div>
                </div>
                {stress !== null && stress !== undefined && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0,
                            bottom: 0,
                            background: `${stressColor}08`,
                            borderRadius: 'var(--radius-lg)',
                            pointerEvents: 'none',
                        }}
                    />
                )}
            </VitalCard>

            {/* Sympathetic */}
            <VitalCard
                className="sympathetic"
                label="⚡ Sympathetic"
                value={symp !== null && symp !== undefined ? fmt(symp) : '--'}
                unit="% Activity"
                inactive={symp === null}
            />

            {/* Parasympathetic */}
            <VitalCard
                className="parasympathetic"
                value={parasymp !== null && parasymp !== undefined ? fmt(parasymp) : '--'}
                unit="% Activity"
                inactive={parasymp === null}
            />

            {/* PRQ */}
            <VitalCard
                className="prq"
                value={prq !== null && prq !== undefined ? fmt(prq, 1) : '--'}
                unit="Recovery Quotient"
                inactive={prq === null}
            />

            {/* Wellness */}
            <VitalCard
                className="wellness"
                value={wellness !== null && wellness !== undefined ? fmt(wellness, 1) : '--'}
                unit="/ 10"
                inactive={wellness === null}
            >
                {wellness !== null && wellness !== undefined && (
                    <div
                        style={{ color: wellnessColor, fontSize: '0.7rem', marginTop: 4, fontWeight: 600 }}
                    >
                        {wellness >= 7 ? 'Good Health' : wellness >= 4 ? 'Moderate' : 'Needs Attention'}
                    </div>
                )}
            </VitalCard>

        </section>
    );
};

export default VitalsGrid;
