import { describe, expect, it } from 'vitest';

import { resolveTimelineTrackForAsset, trackAppendStartMs } from '../src/shared/timelineClipPlacement';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS, type MediaAsset, type TimelineTrack } from '../src/shared/timelineTypes';

const asset = (kind: 'video' | 'audio'): MediaAsset => ({
  id: `asset-${kind}`,
  displayName: `clip.${kind === 'video' ? 'mp4' : 'wav'}`,
  projectRelativePath: `assets/asset-${kind}/original`,
  kind,
  mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav',
  byteLength: 1024,
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:00:00.000Z',
  metadata: { durationMs: 4000 }
});

describe('agent clip placement', () => {
  it('picks the first track matching the asset kind when the caller names none', () => {
    const timeline = createInitialTimeline();

    const video = resolveTimelineTrackForAsset(timeline, asset('video'));
    const audio = resolveTimelineTrackForAsset(timeline, asset('audio'));

    expect(video).toMatchObject({ ok: true });
    expect(video.ok && video.track.id).toBe('video-track-1');
    expect(audio.ok && audio.track.id).toBe('audio-track-1');
  });

  it('names the tracks that exist when the requested one does not', () => {
    // The agent cannot see track ids, so a bare "not found" leaves it guessing.
    const result = resolveTimelineTrackForAsset(createInitialTimeline(), asset('video'), 'video-1');

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('Track video-1 not found');
    expect(result.ok || result.error).toContain('video-track-1 (video), audio-track-1 (audio)');
  });

  it('refuses a track whose kind does not match the asset', () => {
    const result = resolveTimelineTrackForAsset(createInitialTimeline(), asset('video'), 'audio-track-1');

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('is a audio track but asset asset-video is video');
  });

  it('appends after the last clip on the track so added clips never overlap', () => {
    const empty = createInitialTimeline().tracks[0]!;
    expect(trackAppendStartMs(empty)).toBe(0);

    const occupied: TimelineTrack = {
      ...empty,
      kind: 'video',
      clips: [
        { id: 'c1', assetId: 'a', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 3000, sourceDurationMs: 3000, effects: DEFAULT_CLIP_EFFECTS, keyframes: [] },
        { id: 'c2', assetId: 'a', timelineStartMs: 5000, sourceStartMs: 0, sourceEndMs: 2000, sourceDurationMs: 2000, effects: DEFAULT_CLIP_EFFECTS, keyframes: [] }
      ]
    };
    expect(trackAppendStartMs(occupied)).toBe(7000);
  });
});
