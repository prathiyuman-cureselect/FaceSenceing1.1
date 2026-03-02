import React, { memo, useEffect, useRef } from 'react';
import { drawSignalChart, drawSpectrumChart, resizeCanvas } from '../utils/canvas';

interface ChartsSectionProps {
    signalData: number[];
    spectrumData: number[];
    spectrumFreqs: number[];
}

const ChartsSection: React.FC<ChartsSectionProps> = memo(({
    signalData,
    spectrumData,
    spectrumFreqs,
}) => {
    const signalCanvasRef = useRef<HTMLCanvasElement>(null);
    const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);

    // Resize on mount and window resize
    useEffect(() => {
        const resize = () => {
            if (signalCanvasRef.current) resizeCanvas(signalCanvasRef.current);
            if (spectrumCanvasRef.current) resizeCanvas(spectrumCanvasRef.current);
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);

    // Draw signal chart (throttled by data updates)
    useEffect(() => {
        if (signalCanvasRef.current && signalData.length > 1) {
            drawSignalChart(signalCanvasRef.current, signalData);
        }
    }, [signalData]);

    // Draw spectrum chart
    useEffect(() => {
        if (spectrumCanvasRef.current && spectrumData.length > 1) {
            drawSpectrumChart(spectrumCanvasRef.current, spectrumData, spectrumFreqs);
        }
    }, [spectrumData, spectrumFreqs]);

    return (
        <div className="charts-section">
            {/* rPPG Signal Chart */}
            <div className="chart-container card" aria-label="rPPG pulse signal chart">
                <div className="card-header">
                    <span className="card-title">
                        <span aria-hidden="true">〰️</span> rPPG Pulse Signal
                    </span>
                </div>
                <div className="chart-canvas-wrapper">
                    <canvas
                        ref={signalCanvasRef}
                        id="chartSignal"
                        role="img"
                        aria-label="Real-time rPPG pulse signal waveform"
                    />
                </div>
            </div>

            {/* Power Spectrum Chart */}
            <div className="chart-container card" aria-label="Power spectrum chart">
                <div className="card-header">
                    <span className="card-title">
                        <span aria-hidden="true">📈</span> Power Spectrum (FFT)
                    </span>
                </div>
                <div className="chart-canvas-wrapper">
                    <canvas
                        ref={spectrumCanvasRef}
                        id="chartSpectrum"
                        role="img"
                        aria-label="Frequency power spectrum"
                    />
                </div>
            </div>
        </div>
    );
});

ChartsSection.displayName = 'ChartsSection';

export default ChartsSection;
