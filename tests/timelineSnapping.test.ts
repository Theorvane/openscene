import { describe, expect, it } from 'vitest';
import { snapTimelinePosition, type TimelineSnapInput } from '../src/shared/timelineSnapping';
import { DEFAULT_CLIP_EFFECTS, DEFAULT_AUDIO_TRACK_MIX, TIMELINE_SCHEMA_VERSION, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

const clip = (id: string, start: number, duration: number, speed = 1): PersistedTimelineClip => ({
  id, assetId: id, timelineStartMs: start, sourceStartMs: 0,
  sourceEndMs: duration, sourceDurationMs: duration,
  effects: { ...DEFAULT_CLIP_EFFECTS, speed }, keyframes: []
});
const timeline: TimelineDocument = {
  schemaVersion: TIMELINE_SCHEMA_VERSION, transitions: [],
  tracks: [{ id: 'v', name: 'Video', kind: 'video', clips: [clip('a', 1000, 2000), clip('moving', 5000, 1000)] }]
};
const snap = (positionMs: number, extra: Partial<TimelineSnapInput> = {}) => snapTimelinePosition({
  timeline, positionMs, pixelsPerMs: 0.1, playheadMs: 8000,
  enabled: true, excludeClipId: 'moving', ...extra
});

describe('magnetic timeline snapping', () => {
  it('aligns to another clip start and end within eight pixels', () => {
    expect(snap(1050)).toBe(1000);
    expect(snap(3060)).toBe(3000);
    expect(snap(3090)).toBe(3090);
  });
  it('aligns either edge of a moving clip', () => {
    expect(snap(2030, { movingDurationMs: 1000 })).toBe(2000);
  });
  it('only snaps the dragged edge when trimming', () => {
    expect(snap(2030)).toBe(2030);
  });
  it('never snaps to the moving clip itself', () => {
    expect(snap(5020)).toBe(5020);
    expect(snap(5980)).toBe(5980);
  });
  it('aligns with the playhead and origin', () => {
    expect(snap(7950)).toBe(8000);
    expect(snap(50)).toBe(0);
  });
  it('uses screen distance at different zoom levels', () => {
    expect(snap(3060, { pixelsPerMs: 0.2 })).toBe(3060);
    expect(snap(3060, { pixelsPerMs: 0.05 })).toBe(3000);
  });
  it('caps attraction at 250ms in overview zoom', () => {
    expect(snap(3250, { pixelsPerMs: 0.001 })).toBe(3000);
    expect(snap(3251, { pixelsPerMs: 0.001 })).toBe(3251);
  });
  it('does not quantize to a time grid when disabled', () => {
    expect(snap(3047, { enabled: false })).toBe(3047);
  });
  it('never moves the start below zero to align the trailing edge', () => {
    expect(snap(120, { movingDurationMs: 1100 })).toBe(120);
    expect(snap(-40)).toBe(0);
  });
  it('uses speed-adjusted ends across tracks', () => {
    const spedUp: TimelineDocument = { ...timeline, tracks: [
      ...timeline.tracks,
      { id: 'audio', name: 'Audio', kind: 'audio', mix: DEFAULT_AUDIO_TRACK_MIX, clips: [clip('fast', 9000, 4000, 2)] }
    ] };
    expect(snap(11050, { timeline: spedUp })).toBe(11000);
  });
  it('prefers the playhead on equidistant ties', () => {
    expect(snap(1050, { playheadMs: 1100 })).toBe(1100);
  });
  it('handles invalid coordinates without returning NaN', () => {
    expect(snap(NaN)).toBe(0);
    expect(snap(3047, { pixelsPerMs: 0 })).toBe(3047);
    expect(snap(3047, { pixelsPerMs: Infinity })).toBe(3047);
  });
  it('does not mutate project data', () => {
    const before = JSON.stringify(timeline);
    snap(3060);
    expect(JSON.stringify(timeline)).toBe(before);
  });
});
