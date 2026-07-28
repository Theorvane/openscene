import { describe, expect, it } from 'vitest';

import { buildRulerTicks, chooseRulerIntervals, formatRulerLabel } from '../src/renderer/src/editor/timelineRulerTicks';

describe('timeline ruler ticks', () => {
  it('picks wider label intervals as the timeline gets denser', () => {
    const zoomedIn = chooseRulerIntervals({ durationMs: 10_000, rulerWidthPx: 2_000 });
    const zoomedOut = chooseRulerIntervals({ durationMs: 600_000, rulerWidthPx: 800 });

    expect(zoomedIn.labelMs).toBeLessThan(zoomedOut.labelMs);
    expect(zoomedIn.labelMs * (2_000 / 10_000)).toBeGreaterThanOrEqual(90);
    expect(zoomedOut.labelMs * (800 / 600_000)).toBeGreaterThanOrEqual(90);
  });

  it('always chooses a tick interval that divides the label interval', () => {
    const cases = [
      { durationMs: 5_000, rulerWidthPx: 3_000 },
      { durationMs: 60_000, rulerWidthPx: 1_200 },
      { durationMs: 600_000, rulerWidthPx: 700 },
      { durationMs: 7_200_000, rulerWidthPx: 1_000 }
    ];
    for (const input of cases) {
      const { labelMs, tickMs } = chooseRulerIntervals(input);
      expect(labelMs % tickMs).toBe(0);
      expect(tickMs).toBeLessThanOrEqual(labelMs);
    }
  });

  it('builds ticks with labels exactly on major marks and caps the total count', () => {
    const ticks = buildRulerTicks({ durationMs: 60_000, rulerWidthPx: 1_200 });

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(600);
    expect(ticks[0]).toMatchObject({ timeMs: 0, percent: 0, major: true });
    for (const tick of ticks) {
      expect(tick.major).toBe(tick.label !== undefined);
      expect(tick.percent).toBeGreaterThanOrEqual(0);
      expect(tick.percent).toBeLessThanOrEqual(100);
    }
  });

  it('caps tick count even for hostile density inputs', () => {
    expect(buildRulerTicks({ durationMs: 36_000_000, rulerWidthPx: 100_000_000 }).length).toBeLessThanOrEqual(600);
    expect(buildRulerTicks({ durationMs: 0, rulerWidthPx: 500 })).toEqual([]);
    expect(buildRulerTicks({ durationMs: Number.NaN, rulerWidthPx: 500 })).toEqual([]);
  });

  it('formats labels for the interval scale: tenths under a second, m:ss normally, h:mm:ss for hour-long timelines', () => {
    expect(formatRulerLabel(500, 500, 10_000)).toBe('0:00.5');
    expect(formatRulerLabel(90_000, 30_000, 600_000)).toBe('1:30');
    expect(formatRulerLabel(3_660_000, 300_000, 7_200_000)).toBe('1:01:00');
  });
});
