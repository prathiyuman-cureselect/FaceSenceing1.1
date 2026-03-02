import React, { memo, useMemo, useCallback } from 'react';
import type { FinalResults } from '../types';
import { fmt } from '../utils/helpers';

interface ResultsOverlayProps {
    results: FinalResults | null;
    visible: boolean;
    onScanAgain: () => void;
}

interface MetricItem {
    label: string;
    value: string;
    unit: string;
}

interface Category {
    title: string;
    items: MetricItem[];
}

function getHealthInfo(
    val: number | null,
    label: string,
): { color: string; status: string } {
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
        default:
            return { color: '#64748b', status: '' };
    }
}

const ResultsOverlay: React.FC<ResultsOverlayProps> = memo(({
    results,
    visible,
    onScanAgain,
}) => {
    const handlePrint = useCallback(() => window.print(), []);

    const { dateStr, timeStr } = useMemo(() => {
        const now = new Date();
        return {
            dateStr: now.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }),
            timeStr: now.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
            }),
        };
    }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

    const categories: Category[] = useMemo(() => {
        if (!results) return [];
        return [
            {
                title: 'Vital Parameters',
                items: [
                    { label: 'Heart Rate', value: fmt(results.heart_rate), unit: 'BPM' },
                    {
                        label: 'Respiratory Rate',
                        value: fmt(results.respiratory_rate),
                        unit: 'br/min',
                    },
                    {
                        label: 'Blood Pressure',
                        value:
                            results.blood_pressure_sys && results.blood_pressure_dia
                                ? `${fmt(results.blood_pressure_sys)}/${fmt(results.blood_pressure_dia)}`
                                : '--',
                        unit: 'mmHg',
                    },
                    {
                        label: 'Oxygen Saturation',
                        value: fmt(results.spo2_estimate),
                        unit: '%',
                    },
                ],
            },
            {
                title: 'Internal Health Markers',
                items: [
                    {
                        label: 'Hemoglobin (Est)',
                        value: fmt(results.hemoglobin, 1),
                        unit: 'g/dL',
                    },
                    { label: 'Glucose Trend', value: fmt(results.glucose), unit: 'mg/dL' },
                    { label: 'Skin Temp', value: fmt(results.skin_temp, 1), unit: '°F' },
                    { label: 'Hydration', value: fmt(results.hydration, 1), unit: '/ 10' },
                ],
            },
            {
                title: 'Cardiovascular Analysis',
                items: [
                    {
                        label: 'Cardio Age',
                        value: results.cardio_age ? fmt(results.cardio_age) : '--',
                        unit: 'Years',
                    },
                    {
                        label: 'Vascular Health',
                        value: fmt(results.vascular_health),
                        unit: '%',
                    },
                    {
                        label: 'Hypertension Risk',
                        value: results.htn_risk,
                        unit: '',
                    },
                    {
                        label: 'Cardiac Index',
                        value: fmt(results.cardiac_index, 2),
                        unit: 'L/min/m²',
                    },
                ],
            },
        ];
    }, [results]);

    if (!results) return null;

    const confidenceColor =
        results.confidence >= 80
            ? '#059669'
            : results.confidence >= 50
                ? '#d97706'
                : '#dc2626';

    // Sanitize session ID for display
    const safeSessionId = results.sessionId
        .replace(/[^a-zA-Z0-9-]/g, '')
        .slice(0, 16)
        .toUpperCase();

    return (
        <div
            className={`results-overlay ${visible ? 'visible' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Health scan results"
        >
            <div className="results-content" id="printableReport">

                {/* Header */}
                <div className="results-header">
                    <div>
                        <h2>Physiological Profile</h2>
                        <span className="results-subtitle">AI-Driven Vital Sign Assessment</span>
                    </div>
                    <div className="report-metadata">
                        <div><strong>Ref:</strong> TG-{safeSessionId}</div>
                        <div><strong>Date:</strong> {dateStr}</div>
                        <div><strong>Time:</strong> {timeStr}</div>
                    </div>
                </div>

                {/* Hero Strip */}
                <div className="results-hero-strip">
                    <div className="hero-strip-item">
                        <div className="hero-strip-label">Subject Gender</div>
                        <div className="hero-strip-value">{results.estimatedGender}</div>
                    </div>
                    <div className="hero-strip-divider" aria-hidden="true" />
                    <div className="hero-strip-item">
                        <div className="hero-strip-label">Clinical Age Est.</div>
                        <div className="hero-strip-value">
                            {results.estimatedAge ? `${results.estimatedAge} yrs` : '--'}
                        </div>
                    </div>
                    <div className="hero-strip-divider" aria-hidden="true" />
                    <div className="hero-strip-item">
                        <div className="hero-strip-label">Emotional State</div>
                        <div className="hero-strip-value">
                            {results.estimatedSentiment || 'Neutral'}
                        </div>
                    </div>
                    <div className="hero-strip-divider" aria-hidden="true" />
                    <div className="hero-strip-item">
                        <div className="hero-strip-label">Data Fidelity</div>
                        <div
                            className="hero-strip-value"
                            style={{ color: confidenceColor }}
                        >
                            {results.confidence}%
                        </div>
                    </div>
                </div>

                {/* Categories */}
                <div className="results-categories">
                    {categories.map((cat) => (
                        <div key={cat.title} className="report-category-group">
                            <div className="report-category-title">{cat.title}</div>
                            <div className="report-metric-grid">
                                {cat.items.map((item) => {
                                    const numVal =
                                        item.value === '--' || item.value.includes('/')
                                            ? null
                                            : parseFloat(item.value);
                                    const info = getHealthInfo(numVal, item.label);
                                    return (
                                        <div key={item.label} className="report-metric-item">
                                            <div>
                                                <div className="metric-label">{item.label}</div>
                                                <div className="metric-value-row">
                                                    <span className="metric-value">{item.value}</span>
                                                    {item.unit && (
                                                        <span className="metric-unit">{item.unit}</span>
                                                    )}
                                                </div>
                                            </div>
                                            {info.status && (
                                                <span
                                                    className="metric-status-badge"
                                                    style={{
                                                        background: `${info.color}15`,
                                                        color: info.color,
                                                    }}
                                                >
                                                    {info.status}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Wellness & Stress Summary */}
                <div className="report-category-group">
                    <div className="report-category-title">Autonomic & Wellness</div>
                    <div className="report-metric-grid">
                        <div className="report-metric-item">
                            <div>
                                <div className="metric-label">Stress Index</div>
                                <div className="metric-value-row">
                                    <span className="metric-value">{fmt(results.stress_index)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="report-metric-item">
                            <div>
                                <div className="metric-label">Wellness Score</div>
                                <div className="metric-value-row">
                                    <span className="metric-value">{fmt(results.wellness_score, 1)}</span>
                                    <span className="metric-unit">/ 10</span>
                                </div>
                            </div>
                            {results.wellness_score !== null && (
                                <span
                                    className="metric-status-badge"
                                    style={{
                                        background: results.wellness_score >= 7 ? '#05966915' : '#dc262615',
                                        color: results.wellness_score >= 7 ? '#059669' : '#dc2626',
                                    }}
                                >
                                    {results.wellness_score >= 7 ? 'Good' : results.wellness_score >= 4 ? 'Moderate' : 'Low'}
                                </span>
                            )}
                        </div>
                        <div className="report-metric-item">
                            <div>
                                <div className="metric-label">Sympathetic</div>
                                <div className="metric-value-row">
                                    <span className="metric-value">{fmt(results.sympathetic_activity)}</span>
                                    <span className="metric-unit">%</span>
                                </div>
                            </div>
                        </div>
                        <div className="report-metric-item">
                            <div>
                                <div className="metric-label">Parasympathetic</div>
                                <div className="metric-value-row">
                                    <span className="metric-value">{fmt(results.parasympathetic_activity)}</span>
                                    <span className="metric-unit">%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="results-footer">
                    <p className="results-disclaimer">
                        <strong>Medical Disclaimer:</strong> This diagnostic report is
                        generated using AI facial analysis (Remote Photoplethysmography). It
                        is intended for wellness tracking only and does not constitute a
                        clinical diagnosis. Always consult with a qualified healthcare
                        professional for medical advice.
                    </p>
                    <div className="results-actions">
                        <button
                            className="btn btn-ghost"
                            id="btnPrintReport"
                            onClick={handlePrint}
                            aria-label="Download or print this report"
                        >
                            Download / Print Report
                        </button>
                        <button
                            className="btn btn-primary btn-start"
                            id="btnScanAgain"
                            onClick={onScanAgain}
                            aria-label="Start a new scan"
                        >
                            🔄 New Analysis
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
});

ResultsOverlay.displayName = 'ResultsOverlay';

export default ResultsOverlay;
