import { describe, expect, it } from 'vitest';

import { preflightExport, preflightSummary, type ExportCapabilities } from '../src/shared/exportPreflight';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import type { MediaAsset, TimelineDocument } from '../src/shared/timelineTypes';

/**
 * Whether this renderer can make this cut, asked before it starts.
 *
 * Every case here was once a late failure with its own wording: a layer dropped
 * inside a running export, a clip past the end of its file that said nothing at
 * all, a missing asset that failed in two different places on two surfaces.
 */

const ABLE: ExportCapabilities = { stills: true, layeredVideo: true };
const PHONE: ExportCapabilities = { stills: true, layeredVideo: false };

function asset(id: string, durationMs: number | null, kind: MediaAsset['kind'] = 'video'): MediaAsset {
  return {
    id,
    displayName: id,
    projectRelativePath: `media/${id}.mp4`,
    kind,
    mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    byteLength: 0,
    metadata: durationMs === null ? null : { durationMs, width: 1_920, height: 1_080 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

type ClipSpec = {
  readonly assetId: string;
  readonly startMs: number;
  readonly sourceStartMs?: number;
  readonly sourceEndMs?: number;
  readonly track?: number;
};

function timelineOf(clips: readonly ClipSpec[]): TimelineDocument {
  const base = createInitialTimeline();
  const videoTracks = base.tracks.filter((track) => track.kind === 'video');
  // A second video track, because layering is one of the things being asked
  // about and the starting document has one.
  const tracks = [...base.tracks, { ...videoTracks[0]!, id: 'video-2', name: 'Video 2', clips: [] }];

  return {
    ...base,
    tracks: tracks.map((track, trackIndex) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            clips: clips
              .filter((clip) => (clip.track ?? 0) === (trackIndex === 0 ? 0 : trackIndex))
              .map((clip, index) => ({
                id: `clip-${trackIndex}-${index}`,
                assetId: clip.assetId,
                timelineStartMs: clip.startMs,
                sourceStartMs: clip.sourceStartMs ?? 0,
                sourceEndMs: clip.sourceEndMs ?? 2_000,
                sourceDurationMs: 10_000,
                effects: { ...DEFAULT_CLIP_EFFECTS },
                keyframes: []
              }))
          }
    )
  } as TimelineDocument;
}

describe('before the render starts', () => {
  it('passes a cut this renderer can make', () => {
    const problems = preflightExport({
      timeline: timelineOf([{ assetId: 'a', startMs: 0 }]),
      assets: [asset('a', 5_000)],
      capabilities: ABLE
    });
    expect(problems).toEqual([]);
    expect(preflightSummary(problems)).toBe('The cut is ready to render.');
  });

  it('says an empty timeline is empty, and nothing else', () => {
    const problems = preflightExport({ timeline: timelineOf([]), assets: [], capabilities: PHONE });
    expect(problems).toEqual([{ kind: 'empty', detail: 'There is nothing on the timeline to export.' }]);
  });

  it('names media the project no longer has', () => {
    const problems = preflightExport({
      timeline: timelineOf([{ assetId: 'a', startMs: 0 }, { assetId: 'gone', startMs: 2_000 }]),
      assets: [asset('a', 5_000)],
      capabilities: ABLE
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'missing-asset' });
    expect(problems[0]!.detail).toContain('1 clip points');
  });

  it('catches a clip that runs past the end of its own file', () => {
    // The renderers disagree about this — a frozen tail, or a short segment —
    // and neither says anything. Both are wrong against the cut.
    const problems = preflightExport({
      timeline: timelineOf([{ assetId: 'a', startMs: 0, sourceEndMs: 9_000 }]),
      assets: [asset('a', 5_000)],
      capabilities: ABLE
    });
    expect(problems[0]).toMatchObject({ kind: 'past-source-end' });
    expect(problems[0]!.detail).toContain('4.00s');
  });

  it('forgives the odd frame past the end, which is rounding rather than a mistake', () => {
    const problems = preflightExport({
      timeline: timelineOf([{ assetId: 'a', startMs: 0, sourceEndMs: 5_040 }]),
      assets: [asset('a', 5_000)],
      capabilities: ABLE
    });
    expect(problems).toEqual([]);
  });

  it('says nothing about a still, which has no length of its own, or an unprobed file', () => {
    const problems = preflightExport({
      timeline: timelineOf([{ assetId: 'photo', startMs: 0, sourceEndMs: 60_000 }, { assetId: 'unprobed', startMs: 60_000 }]),
      assets: [asset('photo', null, 'image'), asset('unprobed', null)],
      capabilities: ABLE
    });
    expect(problems).toEqual([]);
  });

  it('refuses stills on a build that cannot render them, and allows them on one that can', () => {
    const timeline = timelineOf([{ assetId: 'photo', startMs: 0 }]);
    const assets = [asset('photo', null, 'image')];
    expect(preflightExport({ timeline, assets, capabilities: { stills: false, layeredVideo: false } })[0]).toMatchObject({
      kind: 'stills'
    });
    expect(preflightExport({ timeline, assets, capabilities: PHONE })).toEqual([]);
  });

  it('refuses two clips over the same moment where the renderer cannot composite', () => {
    // On Android this was found inside a running export, as a layer that was
    // simply not in the finished file.
    const timeline = timelineOf([
      { assetId: 'a', startMs: 0, sourceEndMs: 4_000 },
      { assetId: 'b', startMs: 1_000, sourceEndMs: 3_000, track: 2 }
    ]);
    const assets = [asset('a', 10_000), asset('b', 10_000)];
    expect(preflightExport({ timeline, assets, capabilities: PHONE })[0]).toMatchObject({ kind: 'layered-video' });
    // The desktop composites, so the same cut is fine there.
    expect(preflightExport({ timeline, assets, capabilities: ABLE })).toEqual([]);
  });

  it('allows two tracks whose clips do not overlap, because nothing is being composited', () => {
    const problems = preflightExport({
      timeline: timelineOf([
        { assetId: 'a', startMs: 0, sourceEndMs: 2_000 },
        { assetId: 'b', startMs: 4_000, sourceEndMs: 2_000, track: 2 }
      ]),
      assets: [asset('a', 10_000), asset('b', 10_000)],
      capabilities: PHONE
    });
    expect(problems).toEqual([]);
  });

  it('reports everything wrong at once rather than one thing per attempt', () => {
    const problems = preflightExport({
      timeline: timelineOf([
        { assetId: 'gone', startMs: 0 },
        { assetId: 'a', startMs: 2_000, sourceEndMs: 30_000 },
        { assetId: 'photo', startMs: 2_500, track: 2 }
      ]),
      assets: [asset('a', 5_000), asset('photo', null, 'image')],
      capabilities: { stills: false, layeredVideo: false }
    });
    expect(problems.map((problem) => problem.kind)).toEqual([
      'missing-asset',
      'past-source-end',
      'stills',
      'layered-video'
    ]);
  });
});

describe('both surfaces ask before they render', () => {
  const readRepo = async (path: string) =>
    (await import('node:fs/promises')).readFile(new URL(`../${path}`, import.meta.url), 'utf8');

  it('the desktop refuses the job rather than starting one', async () => {
    const service = await readRepo('src/main/exportIpcService.ts');
    // Before the job exists, or a refused export leaves a job behind that
    // nothing will ever finish.
    expect(service.indexOf('preflightExport({')).toBeLessThan(service.indexOf('jobs.create('));
    expect(service).toContain("fail('EXPORT_REFUSED'");
  });

  it('the phone asks with what its own build reports it can do', async () => {
    const composition = await readRepo('mobile/src/lib/exportComposition.ts');
    expect(composition).toContain('stills: areStillsRenderable');
    expect(composition).toContain('layeredVideo: areLayersComposited');
  });

  it('each renderer says whether it composites, rather than the phone assuming', async () => {
    const android = await readRepo(
      'mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    const ios = await readRepo('mobile/modules/video-export/ios/VideoExportModule.swift');
    expect(android).toContain('Property("supportsLayeredVideo") { false }');
    expect(ios).toContain('Property("supportsLayeredVideo") { true }');

    // The Android renderer keeps its own refusal as a backstop: the preflight
    // makes it unreachable from the app, not from anything else that calls in.
    expect(android).toContain('ERR_LAYERED_VIDEO');
  });

  it('a build that was never asked reports no, which is what the older ones mean', async () => {
    const bridge = await readRepo('mobile/modules/video-export/index.ts');
    expect(bridge).toContain("nativeModule?.supportsLayeredVideo === true");
  });
});
