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
    if (value >= 0.8) return '#059669'; // Emerald (Excellent)
    if (value >= 0.6) return '#10b981'; // Green (Good)
    if (value >= 0.4) return '#fbbf24'; // Amber (Fair)
    if (value >= 0.2) return '#f87171'; // Red (Poor)
    return '#94a3b8'; // Muted (Rejected)
}

export function isDataAccurate(
    state: Pick<
        ScanState,
        'allHR' | 'goodMeasurements' | 'totalMeasurements'
    >
): boolean {
    // RELAXED: If we have at least 40 samples (~4 seconds of data), allow completion
    return state.allHR.length >= 40;
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
