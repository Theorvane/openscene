import { describe, expect, it } from 'vitest';

import { buildCompositionPlan, CompositionPlanError } from '../src/shared/videoCompositionPlan';
import { addTrack, createInitialTimeline, INITIAL_AUDIO_TRACK_ID, INITIAL_VIDEO_TRACK_ID } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

function clip(id: string, assetId: string, startMs: number, effects = {}): PersistedTimelineClip {
  return {
    id,
    assetId,
    timelineStartMs: startMs,
    sourceStartMs: 0,
    sourceEndMs: 2_000,
    sourceDurationMs: 2_000,
    effects: { ...DEFAULT_CLIP_EFFECTS, ...effects },
    keyframes: []
  };
}

const SIZE = { width: 1920, height: 1080, frameRate: 30 } as const;

function planFor(timeline: TimelineDocument) {
  return buildCompositionPlan({ timeline, ...SIZE });
}

describe('composition plan', () => {
  it('refuses an empty timeline rather than exporting nothing', () => {
    expect(() => planFor(createInitialTimeline())).toThrow(CompositionPlanError);
  });

  it('lists each source once and indexes segments into it', () => {
    // Given
    const base = createInitialTimeline();
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.id === INITIAL_VIDEO_TRACK_ID
          ? { ...track, clips: [clip('a', 'asset-1', 0), clip('b', 'asset-1', 3_000)] }
          : track
      )
    };

    // When
    const plan = planFor(timeline);

    // Then
    // Both pipelines load an asset once and read ranges out of it; repeating the
    // id per segment would make them open the same file twice.
    expect(plan.sources).toEqual(['asset-1']);
    expect(plan.videoSegments.map((segment) => segment.sourceIndex)).toEqual([0, 0]);
  });

  it('orders video segments bottom row first', () => {
    // Given
    const withSecond = addTrack(createInitialTimeline(), { id: 'video-2', name: 'Video 2', kind: 'video' });
    if (withSecond === null) throw new Error('expected a second video track');
    const timeline: TimelineDocument = {
      ...withSecond,
      tracks: withSecond.tracks.map((track) => {
        if (track.id === INITIAL_VIDEO_TRACK_ID) return { ...track, clips: [clip('top', 'asset-top', 0)] };
        if (track.id === 'video-2') return { ...track, clips: [clip('bottom', 'asset-bottom', 0)] };
        return track;
      })
    };

    // When
    const plan = planFor(timeline);

    // Then
    // A pipeline that stacks in order must end with the timeline's top row on
    // top — the same inversion the FFmpeg overlay chain needs.
    expect(plan.sources[plan.videoSegments[0]?.sourceIndex ?? -1]).toBe('asset-bottom');
    expect(plan.sources[plan.videoSegments[1]?.sourceIndex ?? -1]).toBe('asset-top');
    // And says so outright, for the renderer that cannot read it off the order:
    // a Media3 sequence plays its items in turn, so Android has to know where
    // one layer ends and the next begins rather than infer it from timings that
    // happen not to overlap.
    expect(plan.videoSegments[0]?.layer).toBe(0);
    expect(plan.videoSegments[1]?.layer).toBe(1);
  });

  it('numbers the layers of clips that cover the same moment', () => {
    // Given: two rows, each with a clip over the other.
    const withSecond = addTrack(createInitialTimeline(), { id: 'video-2', name: 'Video 2', kind: 'video' });
    if (withSecond === null) throw new Error('expected a second video track');
    const timeline: TimelineDocument = {
      ...withSecond,
      tracks: withSecond.tracks.map((track) => {
        if (track.id === INITIAL_VIDEO_TRACK_ID) return { ...track, clips: [clip('over', 'asset-over', 500)] };
        if (track.id === 'video-2') return { ...track, clips: [clip('under', 'asset-under', 0)] };
        return track;
      })
    };

    // When
    const plan = planFor(timeline);

    // Then: overlapping in time, and separated by layer rather than refused.
    const under = plan.videoSegments.find((segment) => plan.sources[segment.sourceIndex] === 'asset-under');
    const over = plan.videoSegments.find((segment) => plan.sources[segment.sourceIndex] === 'asset-over');
    expect(under?.layer).toBe(0);
    expect(over?.layer).toBe(1);
    expect(over?.timelineStartMs).toBeLessThan((under?.sourceEndMs ?? 0));
  });

  it('drops clips that would composite to nothing', () => {
    // Given
    const base = createInitialTimeline();
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.id === INITIAL_VIDEO_TRACK_ID
          ? {
              ...track,
              clips: [clip('invisible', 'asset-1', 0, { opacity: 0 }), clip('flat', 'asset-2', 3_000, { scale: 0 })]
            }
          : track
      )
    };

    // When / Then
    expect(planFor(timeline).videoSegments).toEqual([]);
  });

  it('folds the track mix into each audio segment', () => {
    // Given
    const base = createInitialTimeline();
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.id === INITIAL_AUDIO_TRACK_ID
          ? { ...track, clips: [clip('vo', 'asset-audio', 0, { volume: 0.5 })] }
          : track
      )
    };

    // When
    const plan = planFor(timeline);

    // Then
    // 0 dB is unity, so the segment carries the clip's own volume.
    expect(plan.audioSegments).toHaveLength(1);
    expect(plan.audioSegments[0]?.gain).toBeCloseTo(0.5, 5);
  });

  it('lets a muted track win over a clip that is not silent', () => {
    // Given
    const base = createInitialTimeline();
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        // Narrowed on kind: only an audio track carries a mix.
        track.kind === 'audio'
          ? { ...track, mix: { ...track.mix, muted: true }, clips: [clip('vo', 'asset-audio', 0)] }
          : track
      )
    };

    // When / Then
    // Muting a track is a decision about the whole track, as it is in the editor.
    expect(planFor(timeline).audioSegments[0]?.gain).toBe(0);
  });
});
