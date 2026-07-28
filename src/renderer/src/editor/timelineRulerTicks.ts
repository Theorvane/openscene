/**
 * Adaptive time ruler math: pick label/tick intervals from a time ladder based
 * on the actual pixel density, so the marks always correspond to real times
 * and stay readable at every zoom level (reference-NLE behavior: labels need
 * wide spacing, ticks can be denser, and ticks must divide labels so every
 * label lands on a tick).
 */

export type RulerTick = {
  readonly timeMs: number;
  readonly percent: number;
  readonly major: boolean;
  readonly label?: string;
};

const INTERVAL_LADDER_MS = [
  100, 200, 250, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000
] as const;

const MIN_LABEL_SPACING_PX = 90;
const MIN_TICK_SPACING_PX = 12;
const MAX_TICKS = 600;

export type RulerIntervals = {
  readonly labelMs: number;
  readonly tickMs: number;
};

export function chooseRulerIntervals(input: { readonly durationMs: number; readonly rulerWidthPx: number }): RulerIntervals {
  const fallback: RulerIntervals = { labelMs: INTERVAL_LADDER_MS[INTERVAL_LADDER_MS.length - 1]!, tickMs: INTERVAL_LADDER_MS[INTERVAL_LADDER_MS.length - 1]! };
  if (!Number.isFinite(input.durationMs) || !Number.isFinite(input.rulerWidthPx) || input.durationMs <= 0 || input.rulerWidthPx <= 0) {
    return fallback;
  }
  const pxPerMs = input.rulerWidthPx / input.durationMs;

  const labelMs = INTERVAL_LADDER_MS.find((interval) => interval * pxPerMs >= MIN_LABEL_SPACING_PX) ?? fallback.labelMs;

  // Densest ladder interval that stays readable AND divides the label interval,
  // so every label sits exactly on a tick.
  let tickMs = labelMs;
  for (const interval of INTERVAL_LADDER_MS) {
    if (interval * pxPerMs >= MIN_TICK_SPACING_PX && labelMs % interval === 0) {
      tickMs = interval;
      break;
    }
  }

  return { labelMs, tickMs };
}

export function formatRulerLabel(timeMs: number, labelMs: number, durationMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (labelMs < 1_000) {
    const tenths = Math.floor((timeMs % 1000) / 100);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  }
  if (durationMs >= 3_600_000) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function buildRulerTicks(input: { readonly durationMs: number; readonly rulerWidthPx: number }): readonly RulerTick[] {
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) return [];
  const { labelMs, tickMs } = chooseRulerIntervals(input);

  const ticks: RulerTick[] = [];
  for (let timeMs = 0; timeMs <= input.durationMs && ticks.length < MAX_TICKS; timeMs += tickMs) {
    const major = timeMs % labelMs === 0;
    const tick: RulerTick = {
      timeMs,
      percent: (timeMs / input.durationMs) * 100,
      major,
      ...(major ? { label: formatRulerLabel(timeMs, labelMs, input.durationMs) } : {})
    };
    ticks.push(tick);
  }
  return ticks;
}
