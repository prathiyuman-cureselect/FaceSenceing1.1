import { CONFIG } from '../config/constants';

// ─── Grid ─────────────────────────────────────────────────────────────────────

export function drawGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
): void {
    ctx.strokeStyle = CONFIG.COLORS.grid;
    ctx.lineWidth = 1;

    for (let i = 1; i < 4; i++) {
        const y = (i / 4) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    for (let i = 1; i < 6; i++) {
        const x = (i / 6) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}

// ─── Signal Chart ─────────────────────────────────────────────────────────────

export function drawSignalChart(
    canvas: HTMLCanvasElement,
    data: number[],
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;

    drawGrid(ctx, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 10;

    ctx.beginPath();
    ctx.strokeStyle = CONFIG.COLORS.signal;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = CONFIG.COLORS.signalGlow;
    ctx.shadowBlur = 8;

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = padding + (1 - (data[i] - min) / range) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
}

// ─── Spectrum Chart ────────────────────────────────────────────────────────────

export function drawSpectrumChart(
    canvas: HTMLCanvasElement,
    data: number[],
    freqs: number[],
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;

    drawGrid(ctx, w, h);

    const max = Math.max(...data);
    const padding = 10;

    ctx.beginPath();
    ctx.strokeStyle = CONFIG.COLORS.spectrum;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const normalized = max > 0 ? data[i] / max : 0;
        const y = padding + (1 - normalized) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, CONFIG.COLORS.spectrumFill);
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    if (data.length > 0) {
        const peakIdx = data.indexOf(Math.max(...data));
        const peakX = (peakIdx / (data.length - 1)) * w;

        ctx.beginPath();
        ctx.arc(peakX, padding + 4, 4, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.COLORS.spectrum;
        ctx.fill();

        if (freqs.length > peakIdx) {
            const bpm = (freqs[peakIdx] * 60).toFixed(0);
            ctx.font = '11px JetBrains Mono, monospace';
            ctx.fillStyle = CONFIG.COLORS.spectrum;
            ctx.textAlign = 'center';
            ctx.fillText(`${bpm} BPM`, peakX, padding - 4);
        }
    }
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export function drawSparkline(
    canvas: HTMLCanvasElement,
    data: number[],
    strokeColor: string,
    fillColor: string,
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;

    const min = Math.min(...data) - 2;
    const max = Math.max(...data) + 2;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = (1 - (data[i] - min) / range) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
}

// ─── Canvas DPR resize ─────────────────────────────────────────────────────────

export function resizeCanvas(canvas: HTMLCanvasElement, height?: number): void {
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = height ?? parent.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
}

// ─── Face Overlay ──────────────────────────────────────────────────────────────

export function drawFaceOverlay(
    svg: SVGSVGElement,
    x: number,
    y: number,
    w: number,
    h: number,
): void {
    svg.innerHTML = '';

    const padding = 20;
    const cw = 40;
    const corners = [
        `M ${x - padding} ${y - padding + cw} V ${y - padding} H ${x - padding + cw}`,
        `M ${x + w + padding - cw} ${y - padding} H ${x + w + padding} V ${y - padding + cw}`,
        `M ${x + w + padding} ${y + h + padding - cw} V ${y + h + padding} H ${x + w + padding - cw}`,
        `M ${x - padding + cw} ${y + h + padding} H ${x - padding} V ${y + h + padding - cw}`,
    ];

    corners.forEach((d) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', '#10b981'); // Emerald
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
    });

    const patches = [
        { px: x + w * 0.3, py: y + h * 0.05, pw: w * 0.4, ph: h * 0.15 }, // Forehead
        { px: x + w * 0.15, py: y + h * 0.45, pw: w * 0.2, ph: h * 0.2 }, // L Cheek
        { px: x + w * 0.65, py: y + h * 0.45, pw: w * 0.2, ph: h * 0.2 }, // R Cheek
    ];

    patches.forEach((p) => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(p.px));
        rect.setAttribute('y', String(p.py));
        rect.setAttribute('width', String(p.pw));
        rect.setAttribute('height', String(p.ph));
        rect.setAttribute('fill', 'rgba(16, 185, 129, 0.05)');
        rect.setAttribute('stroke', 'rgba(16, 185, 129, 0.2)');
        rect.setAttribute('stroke-width', '1');
        svg.appendChild(rect);
    });
}
