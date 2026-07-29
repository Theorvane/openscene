import { describe, expect, it } from 'vitest';

import {
  formatFrameTimestamp,
  planFrameTimestamps,
  WATCH_FRAME_DEFAULT_MAX,
  WATCH_FRAME_HARD_CAP
} from '../src/main/videoFrameAnalysis';

describe('video frame analysis planning', () => {
  it('budgets full-video sampling by duration and centers timestamps in the range', () => {
    const shortClip = planFrameTimestamps({ durationMs: 10_000 });
    expect(shortClip).toHaveLength(8);
    expect(shortClip[0]).toBe(Math.round(10_000 / 16));
    expect(shortClip[7]).toBeLessThan(10_000);

    expect(planFrameTimestamps({ durationMs: 45_000 })).toHaveLength(10);
    expect(planFrameTimestamps({ durationMs: 120_000 })).toHaveLength(12);
    // The hour-long budget is 14, but the default per-call cap keeps it at 12
    // unless maxFrames raises it (covered below).
    expect(planFrameTimestamps({ durationMs: 3_600_000 })).toHaveLength(12);
  });

  it('samples focused ranges denser but never above 2 fps', () => {
    const focused = planFrameTimestamps({ durationMs: 60_000, startMs: 10_000, endMs: 20_000 });
    expect(focused).toHaveLength(10);
    expect(focused[0]).toBeGreaterThanOrEqual(10_000);
    expect(focused[focused.length - 1]).toBeLessThanOrEqual(20_000);

    // A 2-second window allows at most 4 frames at the 2 fps rate cap.
    expect(planFrameTimestamps({ durationMs: 60_000, startMs: 0, endMs: 2_000 })).toHaveLength(4);
  });

  it('honors maxFrames within the hard cap and default', () => {
    expect(planFrameTimestamps({ durationMs: 120_000, maxFrames: 5 })).toHaveLength(5);
    expect(planFrameTimestamps({ durationMs: 3_600_000, maxFrames: 100 })).toHaveLength(14);
    expect(WATCH_FRAME_DEFAULT_MAX).toBeLessThanOrEqual(WATCH_FRAME_HARD_CAP);
  });

  it('returns nothing for unusable input', () => {
    expect(planFrameTimestamps({ durationMs: 0 })).toEqual([]);
    expect(planFrameTimestamps({ durationMs: Number.NaN })).toEqual([]);
    expect(planFrameTimestamps({ durationMs: 10_000, startMs: 8_000, endMs: 8_000 })).toEqual([]);
    expect(planFrameTimestamps({ durationMs: 10_000, startMs: 20_000 })).toEqual([]);
  });

  it('formats frame timestamps as m:ss', () => {
    expect(formatFrameTimestamp(500)).toBe('0:00');
    expect(formatFrameTimestamp(65_000)).toBe('1:05');
    expect(formatFrameTimestamp(600_000)).toBe('10:00');
  });
});
