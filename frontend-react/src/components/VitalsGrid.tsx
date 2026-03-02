import React, { memo, useEffect, useRef, useMemo } from 'react';
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

const VitalCard: React.FC<VitalCardProps> = memo(({
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
));

VitalCard.displayName = 'VitalCard';

// ─── Format helper ────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, dec = 0): string {
    if (val === null || val === undefined) return '--';
    const num = Number(val);
    if (!Number.isFinite(num)) return '--';
    return num.toFixed(dec);
}

// ─── Main Grid ────────────────────────────────────────────────────────────────

const VitalsGrid: React.FC<VitalsGridProps> = memo(({
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

    // ─── Derived values ─────────────────────────────────────────────────────────
    const {
        hr, rr, hrv, sdnn, pnn50, spo2, sys, dia, temp,
        pi, stress, lfhf, symp, parasymp, prq, wellness,
        balanceText, balanceColor, wellnessColor, stressColor,
        sensing, calibrating,
    } = useMemo(() => {
        const _hr = vitals?.heart_rate ?? null;
        const _rr = vitals?.respiratory_rate ?? null;
        const _hrv = vitals?.hrv_rmssd ?? null;
        const _sdnn = vitals?.hrv_sdnn ?? null;
        const _pnn50 = vitals?.hrv_pnn50 ?? null;
        const _spo2 = vitals?.spo2_estimate ?? null;
        const _sys = vitals?.blood_pressure_sys ?? null;
        const _dia = vitals?.blood_pressure_dia ?? null;
        const _temp = vitals?.skin_temp ?? null;
        const _pi = vitals?.perfusion_index ?? null;
        const _stress = vitals?.stress_index ?? null;
        const _lfhf = vitals?.lf_hf_ratio ?? null;
        const _symp = vitals?.sympathetic_activity ?? null;
        const _parasymp = vitals?.parasympathetic_activity ?? null;
        const _prq = vitals?.prq ?? null;
        const _wellness = vitals?.wellness_score ?? null;

        let _balanceText = '--';
        let _balanceColor: string | undefined;
        if (_lfhf !== null) {
            if (_lfhf > 2.0) { _balanceText = 'Sympathetic'; _balanceColor = '#f87171'; }
            else if (_lfhf < 0.5) { _balanceText = 'Parasymp.'; _balanceColor = '#60a5fa'; }
            else { _balanceText = 'Balanced'; _balanceColor = '#10b981'; }
        }

        let _wellnessColor: string | undefined;
        if (_wellness !== null) {
            _wellnessColor = _wellness >= 7 ? '#34d399' : _wellness >= 4 ? '#fbbf24' : '#ef4444';
        }

        let _stressColor: string | undefined;
        if (_stress !== null) {
            _stressColor = _stress > 500 ? '#ef4444' : _stress > 150 ? '#f59e0b' : '#10b981';
        }

        return {
            hr: _hr, rr: _rr, hrv: _hrv, sdnn: _sdnn, pnn50: _pnn50,
            spo2: _spo2, sys: _sys, dia: _dia, temp: _temp, pi: _pi,
            stress: _stress, lfhf: _lfhf, symp: _symp, parasymp: _parasymp,
            prq: _prq, wellness: _wellness,
            balanceText: _balanceText, balanceColor: _balanceColor,
            wellnessColor: _wellnessColor, stressColor: _stressColor,
            sensing: isScanning ? 'Sensing...' : undefined,
            calibrating: isScanning ? 'Calibrating...' : undefined,
        };
    }, [vitals, isScanning]);

    return (
        <section className="vitals-grid" aria-label="Vital signs">

            {/* Heart Rate */}
            <VitalCard
                className="hr"
                value={sensing ?? (hr !== null ? fmt(hr) : '--')}
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
                value={sensing ?? (rr !== null ? fmt(rr) : '--')}
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
                value={temp !== null ? fmt(temp, 1) : '--'}
                unit="°F"
                inactive={!temp}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label">Perfusion Idx</div>
                        <div className="hrv-metric-value">{pi !== null ? fmt(pi, 1) : '--'}</div>
                    </div>
                </div>
            </VitalCard>

            {/* Stress & ANS */}
            <VitalCard
                className="stress"
                value={stress !== null ? fmt(stress) : '--'}
                unit="Stress Index"
                inactive={stress === null}
            >
                <div className="hrv-detail-row">
                    <div>
                        <div className="hrv-metric-label">LF/HF</div>
                        <div className="hrv-metric-value">
                            {lfhf !== null ? fmt(lfhf, 2) : '--'}
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
                {stress !== null && (
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
                value={symp !== null ? fmt(symp) : '--'}
                unit="% Activity"
                inactive={symp === null}
            />

            {/* Parasympathetic */}
            <VitalCard
                className="parasympathetic"
                value={parasymp !== null ? fmt(parasymp) : '--'}
                unit="% Activity"
                inactive={parasymp === null}
            />

            {/* PRQ */}
            <VitalCard
                className="prq"
                value={prq !== null ? fmt(prq, 1) : '--'}
                unit="Recovery Quotient"
                inactive={prq === null}
            />

            {/* Wellness */}
            <VitalCard
                className="wellness"
                value={wellness !== null ? fmt(wellness, 1) : '--'}
                unit="/ 10"
                inactive={wellness === null}
            >
                {wellness !== null && (
                    <div
                        style={{ color: wellnessColor, fontSize: '0.7rem', marginTop: 4, fontWeight: 600 }}
                    >
                        {wellness >= 7 ? 'Good Health' : wellness >= 4 ? 'Moderate' : 'Needs Attention'}
                    </div>
                )}
            </VitalCard>

        </section>
    );
});

VitalsGrid.displayName = 'VitalsGrid';

export default VitalsGrid;
