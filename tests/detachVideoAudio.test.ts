import { describe, expect, it } from 'vitest';

import { detachVideoAudioOnTimeline } from '../src/shared/detachVideoAudio';
import { createInitialTimeline, placeClip } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import type { MediaAsset } from '../src/shared/timelineTypes';

const AUDIO_ASSET: MediaAsset = {
  id: 'detached-audio-asset',
  displayName: 'Take - detached audio.wav',
  projectRelativePath: 'assets/audio/original.wav',
  kind: 'audio',
  mimeType: 'audio/wav',
  byteLength: 10,
  metadata: { durationMs: 10_000 },
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z'
};

describe('detach video audio timeline transaction', () => {
  it('aligns trim, speed and volume automation while muting embedded sound', () => {
    const source = {
      id: 'video-clip',
      assetId: 'video-asset',
      timelineStartMs: 2_000,
      sourceStartMs: 1_000,
      sourceEndMs: 7_000,
      sourceDurationMs: 10_000,
      effects: { ...DEFAULT_CLIP_EFFECTS, speed: 2, volume: 0.6 },
      keyframes: [
        { timelineTimeMs: 2_000, property: 'volume' as const, value: 0.25, interpolation: 'linear' as const },
        { timelineTimeMs: 3_000, property: 'opacity' as const, value: 0.5, interpolation: 'linear' as const }
      ]
    };
    const timeline = placeClip(createInitialTimeline(), { trackId: 'video-track-1', clip: source });
    expect(timeline).not.toBeNull();

    const result = detachVideoAudioOnTimeline(timeline!, {
      sourceClipId: source.id,
      audioAsset: AUDIO_ASSET,
      audioClipId: 'audio-clip',
      fallbackAudioTrackId: 'audio-track-2',
      fallbackAudioTrackName: 'Audio 2'
    });

    expect(result?.audioTrackId).toBe('audio-track-1');
    expect(result?.audioClip).toMatchObject({
      timelineStartMs: 2_000,
      sourceStartMs: 1_000,
      sourceEndMs: 7_000,
      sourceDurationMs: 10_000,
      effects: { speed: 2, volume: 0.6 }
    });
    expect(result?.audioClip.keyframes).toEqual([
      { timelineTimeMs: 2_000, property: 'volume', value: 0.25, interpolation: 'linear' }
    ]);
    const mutedVideo = result?.timeline.tracks[0]?.clips[0];
    expect(mutedVideo?.effects.volume).toBe(0);
    expect(mutedVideo?.keyframes).toEqual([
      { timelineTimeMs: 2_000, property: 'volume', value: 0, interpolation: 'linear' },
      { timelineTimeMs: 3_000, property: 'opacity', value: 0.5, interpolation: 'linear' }
    ]);
  });

  it('creates a new audio track when aligned placement would overlap existing audio', () => {
    let timeline = placeClip(createInitialTimeline(), {
      trackId: 'video-track-1',
      clip: {
        id: 'video-clip', assetId: 'video-asset', timelineStartMs: 0,
        sourceStartMs: 0, sourceEndMs: 5_000, sourceDurationMs: 10_000
      }
    });
    timeline = timeline === null ? null : placeClip(timeline, {
      trackId: 'audio-track-1',
      clip: {
        id: 'existing-audio', assetId: 'music', timelineStartMs: 0,
        sourceStartMs: 0, sourceEndMs: 5_000, sourceDurationMs: 5_000
      }
    });

    const result = timeline === null ? null : detachVideoAudioOnTimeline(timeline, {
      sourceClipId: 'video-clip',
      audioAsset: AUDIO_ASSET,
      audioClipId: 'audio-clip',
      fallbackAudioTrackId: 'audio-track-2',
      fallbackAudioTrackName: 'Audio 2'
    });

    expect(result?.audioTrackId).toBe('audio-track-2');
    expect(result?.timeline.tracks.find((track) => track.id === 'audio-track-2')?.clips).toHaveLength(1);
  });

  it('refuses an audio result too short for the source trim', () => {
    const timeline = placeClip(createInitialTimeline(), {
      trackId: 'video-track-1',
      clip: {
        id: 'video-clip', assetId: 'video-asset', timelineStartMs: 0,
        sourceStartMs: 0, sourceEndMs: 9_000, sourceDurationMs: 10_000
      }
    });
    expect(detachVideoAudioOnTimeline(timeline!, {
      sourceClipId: 'video-clip',
      audioAsset: { ...AUDIO_ASSET, metadata: { durationMs: 8_000 } },
      audioClipId: 'audio-clip',
      fallbackAudioTrackId: 'audio-track-2',
      fallbackAudioTrackName: 'Audio 2'
    })).toBeNull();
  });
});
