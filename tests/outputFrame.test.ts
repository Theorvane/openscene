import { describe, expect, it } from 'vitest';

import { outputFrameFor } from '../src/shared/outputFrame';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { EXPORT_DEFAULTS } from '../src/shared/exportTypes';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import type { MediaAsset, TimelineDocument } from '../src/shared/timelineTypes';

/**
 * A cut comes out the shape it went in.
 *
 * The phone exported everything into 1920×1080, so a clip filmed upright came
 * back pillarboxed. The dimensions were never missing — every asset records
 * them — the export just never asked.
 */

function asset(id: string, width: number | null, height: number | null, kind: MediaAsset['kind'] = 'video'): MediaAsset {
  return {
    id,
    displayName: id,
    projectRelativePath: `media/${id}.mp4`,
    kind,
    mimeType: 'video/mp4',
    byteLength: 0,
    metadata: width === null || height === null ? null : { durationMs: 5_000, width, height },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function timelineOf(clips: readonly { readonly assetId: string; readonly startMs: number }[]): TimelineDocument {
  const base = createInitialTimeline();
  return {
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            clips: clips.map(({ assetId, startMs }, index) => ({
              id: `clip-${index}`,
              assetId,
              timelineStartMs: startMs,
              sourceStartMs: 0,
              sourceEndMs: 2_000,
              sourceDurationMs: 2_000,
              effects: { ...DEFAULT_CLIP_EFFECTS },
              keyframes: []
            }))
          }
    )
  } as TimelineDocument;
}

describe('the frame a cut is rendered into', () => {
  it('takes the shape of the footage rather than a landscape default', () => {
    const frame = outputFrameFor({
      timeline: timelineOf([{ assetId: 'a', startMs: 0 }]),
      assets: [asset('a', 1_080, 1_920)]
    });
    expect(frame).toEqual({ width: 1_080, height: 1_920 });
  });

  it('takes it from the clip the cut opens on', () => {
    // First rather than largest or most common: a person can predict "how it
    // opens" without being told the rule.
    const frame = outputFrameFor({
      timeline: timelineOf([
        { assetId: 'later', startMs: 5_000 },
        { assetId: 'first', startMs: 0 }
      ]),
      assets: [asset('first', 1_080, 1_920), asset('later', 3_840, 2_160)]
    });
    expect(frame).toEqual({ width: 1_080, height: 1_920 });
  });

  it('falls back to 1080p when nothing says otherwise', () => {
    expect(outputFrameFor({ timeline: timelineOf([{ assetId: 'a', startMs: 0 }]), assets: [asset('a', null, null)] }))
      .toEqual({ width: EXPORT_DEFAULTS.width, height: EXPORT_DEFAULTS.height });
    expect(outputFrameFor({ timeline: createInitialTimeline(), assets: [] }))
      .toEqual({ width: EXPORT_DEFAULTS.width, height: EXPORT_DEFAULTS.height });
  });

  it('refuses a shape H.264 will not encode, rather than passing it on', () => {
    // Odd edges are rounded down; a frame larger than 4K or smaller than a
    // thumbnail is not a frame anyone shot.
    expect(outputFrameFor({ timeline: timelineOf([{ assetId: 'a', startMs: 0 }]), assets: [asset('a', 1_081, 1_921)] }))
      .toEqual({ width: 1_080, height: 1_920 });
    expect(outputFrameFor({ timeline: timelineOf([{ assetId: 'a', startMs: 0 }]), assets: [asset('a', 99_999, 4) ] }))
      .toEqual({ width: EXPORT_DEFAULTS.width, height: EXPORT_DEFAULTS.height });
  });

  it('turns the frame when asked, rather than inventing a resolution', () => {
    const portraitSource = { timeline: timelineOf([{ assetId: 'a', startMs: 0 }]), assets: [asset('a', 1_080, 1_920)] };
    expect(outputFrameFor({ ...portraitSource, preference: 'landscape' })).toEqual({ width: 1_920, height: 1_080 });
    expect(outputFrameFor({ ...portraitSource, preference: 'portrait' })).toEqual({ width: 1_080, height: 1_920 });
    // The shorter edge: a square from the longer one would ask the renderer to
    // fill space the footage never had.
    expect(outputFrameFor({ ...portraitSource, preference: 'square' })).toEqual({ width: 1_080, height: 1_080 });
  });

  it('ignores an audio clip when deciding what the picture looks like', () => {
    const frame = outputFrameFor({
      timeline: timelineOf([{ assetId: 'sound', startMs: 0 }, { assetId: 'picture', startMs: 1_000 }]),
      assets: [asset('sound', null, null, 'audio'), asset('picture', 1_080, 1_920)]
    });
    expect(frame).toEqual({ width: 1_080, height: 1_920 });
  });
});
