import type { ScanState } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateSessionId(): string {
    return Math.random().toString(36).substring(2, 10);
}

export function median(arr: number[]): number | null {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function fmt(val: number | null | undefined, decimals = 0): string {
    return val !== null && val !== undefined
        ? Number(val).toFixed(decimals)
        : '--';
}

export function getQualityColor(value: number): string {
    if (value >= 0.8) return '#10b981';
    if (value >= 0.6) return '#06b6d4';
    if (value >= 0.4) return '#f59e0b';
    if (value >= 0.2) return '#ef4444';
    return '#6b7280';
}

export function isDataAccurate(
    state: Pick<
        ScanState,
        'allHR' | 'goodMeasurements' | 'totalMeasurements'
    >,
    snrDb: number,
    overallLevel: string,
    isAcceptable: boolean,
): boolean {
    if (state.allHR.length < 25) return false;

    const isQualityHigh =
        isAcceptable && (snrDb > 6 || overallLevel === 'EXCELLENT');
    if (!isQualityHigh) return false;

    const lastSamples = state.allHR.slice(-8);
    if (lastSamples.length < 8) return false;

    const mean =
        lastSamples.reduce((a, b) => a + b, 0) / lastSamples.length;
    const variance =
        lastSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        lastSamples.length;
    const stdDev = Math.sqrt(variance);

    return stdDev < 1.5;
}

export function getModeString(arr: string[]): string {
    if (arr.length === 0) return 'Unknown';
    const counts: Record<string, number> = {};
    arr.forEach((g) => {
        counts[g] = (counts[g] || 0) + 1;
    });
    return Object.keys(counts).reduce((a, b) =>
        counts[a] > counts[b] ? a : b,
    );
}

export function getMostFrequentString(arr: string[]): string {
    if (!arr || arr.length === 0) return 'Unknown';
    const counts: Record<string, number> = arr.reduce(
        (acc, r) => ({ ...acc, [r]: (acc[r] || 0) + 1 }),
        {} as Record<string, number>,
    );
    return Object.keys(counts).reduce((a, b) =>
        counts[a] > counts[b] ? a : b,
    );
}
