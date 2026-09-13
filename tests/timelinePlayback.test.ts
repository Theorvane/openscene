import { describe, expect, it } from 'vitest';

import {
  isClipActiveAt,
  nextVisualBoundaryMs,
  resolveAudibleClips,
  resolveVisibleClip,
  sourceTimeForClip
} from '../src/shared/timelinePlayback';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { PersistedTimelineClip, TimelineDocument } from '../src/shared/timelineTypes';

function clip(input: {
  id: string;
  assetId?: string;
  startMs: number;
  lengthMs: number;
  sourceStartMs?: number;
  opacity?: number;
}): PersistedTimelineClip {
  const sourceStartMs = input.sourceStartMs ?? 0;
  return {
    id: input.id,
    assetId: input.assetId ?? `asset-${input.id}`,
    timelineStartMs: input.startMs,
    sourceStartMs,
    sourceEndMs: sourceStartMs + input.lengthMs,
    sourceDurationMs: sourceStartMs + input.lengthMs,
    effects: { ...DEFAULT_CLIP_EFFECTS, ...(input.opacity === undefined ? {} : { opacity: input.opacity }) },
    keyframes: []
  };
}

function timelineOf(tracks: TimelineDocument['tracks']): TimelineDocument {
  return { schemaVersion: TIMELINE_SCHEMA_VERSION, tracks, transitions: [] };
}

describe('what plays at a moment', () => {
  it('treats a clip as covering its start but not its end', () => {
    const subject = clip({ id: 'a', startMs: 1_000, lengthMs: 500 });
    expect(isClipActiveAt(subject, 1_000)).toBe(true);
    expect(isClipActiveAt(subject, 1_499)).toBe(true);
    // The end belongs to whatever comes next; counting it twice would show two
    // clips at the same instant on a cut.
    expect(isClipActiveAt(subject, 1_500)).toBe(false);
    expect(isClipActiveAt(subject, 999)).toBe(false);
  });

  it('maps a timeline position onto the trimmed source', () => {
    const subject = clip({ id: 'a', startMs: 2_000, lengthMs: 1_000, sourceStartMs: 4_000 });
    // Two seconds into the timeline clip is six seconds into the file, not two.
    expect(sourceTimeForClip(subject, 2_500)).toBe(4_500);
  });

  it('gives the picture to the first track, which is the topmost', () => {
    const document = timelineOf([
      { id: 'v1', kind: 'video', name: 'V1', clips: [clip({ id: 'top', startMs: 0, lengthMs: 1_000 })] },
      { id: 'v2', kind: 'video', name: 'V2', clips: [clip({ id: 'under', startMs: 0, lengthMs: 1_000 })] }
    ]);
    // Same rule buildCompositionPlan applies when it reverses layers for a
    // renderer that stacks bottom-first; a preview that picked the other one
    // would disagree with the export.
    expect(resolveVisibleClip(document, 500)?.clip.id).toBe('top');
  });

  it('falls through a fully transparent clip to the layer below', () => {
    const document = timelineOf([
      { id: 'v1', kind: 'video', name: 'V1', clips: [clip({ id: 'ghost', startMs: 0, lengthMs: 1_000, opacity: 0 })] },
      { id: 'v2', kind: 'video', name: 'V2', clips: [clip({ id: 'under', startMs: 0, lengthMs: 1_000 })] }
    ]);
    expect(resolveVisibleClip(document, 500)?.clip.id).toBe('under');
  });

  it('shows nothing over a gap rather than the last decoded frame', () => {
    const document = timelineOf([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        clips: [clip({ id: 'a', startMs: 0, lengthMs: 1_000 }), clip({ id: 'b', startMs: 3_000, lengthMs: 1_000 })]
      }
    ]);
    expect(resolveVisibleClip(document, 2_000)).toBeNull();
  });

  it('reports the source offset with the visible clip, so the preview can seek', () => {
    const document = timelineOf([
      { id: 'v1', kind: 'video', name: 'V1', clips: [clip({ id: 'a', startMs: 1_000, lengthMs: 2_000, sourceStartMs: 500 })] }
    ]);
    expect(resolveVisibleClip(document, 1_750)?.sourceTimeMs).toBe(1_250);
  });

  it('leaves muted tracks out of what is audible', () => {
    const document = timelineOf([
      {
        id: 'a1',
        kind: 'audio',
        name: 'A1',
        clips: [clip({ id: 'music', startMs: 0, lengthMs: 5_000 })],
        mix: { ...DEFAULT_AUDIO_TRACK_MIX, muted: true }
      },
      {
        id: 'a2',
        kind: 'audio',
        name: 'A2',
        clips: [clip({ id: 'vo', startMs: 0, lengthMs: 5_000 })],
        mix: { ...DEFAULT_AUDIO_TRACK_MIX }
      }
    ]);
    expect(resolveAudibleClips(document, 1_000).map((entry) => entry.clip.id)).toEqual(['vo']);
  });

  it('finds the next moment the picture changes, and nothing after the last', () => {
    const document = timelineOf([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        clips: [clip({ id: 'a', startMs: 0, lengthMs: 1_000 }), clip({ id: 'b', startMs: 3_000, lengthMs: 1_000 })]
      }
    ]);
    // Playback uses this to jump the gap instead of stopping at the first join.
    expect(nextVisualBoundaryMs(document, 0)).toBe(1_000);
    expect(nextVisualBoundaryMs(document, 1_000)).toBe(3_000);
    expect(nextVisualBoundaryMs(document, 4_000)).toBeNull();
  });
});
