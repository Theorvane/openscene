import { describe, expect, it } from 'vitest';

import { placeClip, replaceClipSource } from '../src/shared/timelineClipLogic';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument } from '../src/shared/timelineTypes';

/**
 * A second take standing in the same place as the first.
 *
 * The whole point is that nothing else moves: the cut around a shot was made
 * against its length, and a take that came back a few frames longer must not
 * slide everything after it.
 */

function timelineWithTwoClips(): TimelineDocument {
  const base = createInitialTimeline();
  const trackId = base.tracks.find((track) => track.kind === 'video')!.id;
  const first = placeClip(base, {
    trackId,
    clip: {
      id: 'clip-a',
      assetId: 'take-1',
      timelineStartMs: 0,
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      sourceDurationMs: 4_000,
      effects: { ...DEFAULT_CLIP_EFFECTS },
      keyframes: []
    }
  })!;
  return placeClip(first, {
    trackId,
    clip: {
      id: 'clip-b',
      assetId: 'other',
      timelineStartMs: 4_000,
      sourceStartMs: 0,
      sourceEndMs: 3_000,
      sourceDurationMs: 3_000,
      effects: { ...DEFAULT_CLIP_EFFECTS },
      keyframes: []
    }
  })!;
}

const clipOf = (timeline: TimelineDocument, id: string) =>
  timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);

describe('swapping in another take', () => {
  it('points the clip at the new file and leaves the cut where it was', () => {
    const next = replaceClipSource(timelineWithTwoClips(), {
      clipId: 'clip-a',
      assetId: 'take-2',
      sourceDurationMs: 4_320
    });
    expect(next).not.toBeNull();
    const clip = clipOf(next!, 'clip-a')!;
    expect(clip).toMatchObject({
      assetId: 'take-2',
      timelineStartMs: 0,
      // The same length as before, out of the top of the longer new file.
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      sourceDurationMs: 4_320
    });
    // The clip after it has not moved.
    expect(clipOf(next!, 'clip-b')).toMatchObject({ timelineStartMs: 4_000 });
    // And the document still opens.
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(next)))).not.toBeNull();
  });

  it('refuses a take too short to cover the shot rather than retiming the cut', () => {
    const next = replaceClipSource(timelineWithTwoClips(), {
      clipId: 'clip-a',
      assetId: 'take-2',
      sourceDurationMs: 2_500
    });
    expect(next).toBeNull();
  });

  it('keeps the in-point of a trimmed clip out of it: a new take starts at its own beginning', () => {
    const base = timelineWithTwoClips();
    const trimmed: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === 'clip-a' ? { ...clip, sourceStartMs: 1_000, sourceEndMs: 3_000 } : clip))
      }))
    } as TimelineDocument;

    const next = replaceClipSource(trimmed, { clipId: 'clip-a', assetId: 'take-2', sourceDurationMs: 9_000 });
    expect(clipOf(next!, 'clip-a')).toMatchObject({ sourceStartMs: 0, sourceEndMs: 2_000 });
  });

  it('says no to a clip that is not there, and to an id nothing could point at', () => {
    const timeline = timelineWithTwoClips();
    expect(replaceClipSource(timeline, { clipId: 'missing', assetId: 'take-2', sourceDurationMs: 9_000 })).toBeNull();
    expect(replaceClipSource(timeline, { clipId: 'clip-a', assetId: '../escape', sourceDurationMs: 9_000 })).toBeNull();
  });
});
