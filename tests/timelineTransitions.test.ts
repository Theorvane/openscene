import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { buildCompositionPlan } from '../src/shared/videoCompositionPlan';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import {
  DEFAULT_TRANSITION_MS,
  cutNearest,
  cuts,
  removeTransitionAtCut,
  setTransitionAtCut,
  transitionForCut
} from '../src/shared/timelineTransitionLogic';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument, type TransitionType } from '../src/shared/timelineTypes';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';

const execFileAsync = promisify(execFile);

/**
 * A transition was previewed and never rendered.
 *
 * `programMonitorPreview` has ramped clip opacity for a dissolve since the
 * timeline gained transitions, and the FFmpeg compiler had never read
 * `timeline.transitions` at all — so the export disagreed with the picture the
 * editor had just shown, silently. These tests hold the two together: the graph
 * carries the ramps, and a rendered file actually goes dark at the cut.
 */

/** Two touching clips on the video track, which is the only place a transition may go. */
function twoClips(): TimelineDocument {
  const base = createInitialTimeline();
  return {
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            clips: [
              {
                id: 'clip-a',
                assetId: 'asset-a',
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 2_000,
                effects: { ...DEFAULT_CLIP_EFFECTS },
                keyframes: []
              },
              {
                id: 'clip-b',
                assetId: 'asset-b',
                timelineStartMs: 2_000,
                sourceStartMs: 0,
                sourceEndMs: 2_000,
                effects: { ...DEFAULT_CLIP_EFFECTS },
                keyframes: []
              }
            ]
          }
    )
  } as TimelineDocument;
}

function withTransition(type: TransitionType, durationMs = DEFAULT_TRANSITION_MS): TimelineDocument {
  const timeline = twoClips();
  const cut = cuts(timeline)[0];
  if (cut === undefined) throw new Error('no cut');
  const next = setTransitionAtCut(timeline, cut, { type, durationMs });
  if (next === null) throw new Error('the rules refused a transition they should accept');
  return next;
}

describe('finding the cut a transition goes on', () => {
  it('finds where two clips touch, and nowhere else', () => {
    expect(cuts(twoClips()).map((cut) => cut.cutMs)).toEqual([2_000]);

    // A gap is a cut to black already; there is nothing there to dissolve.
    const gapped = twoClips();
    const spaced: TimelineDocument = {
      ...gapped,
      tracks: gapped.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : { ...track, clips: track.clips.map((clip) => (clip.id === 'clip-b' ? { ...clip, timelineStartMs: 3_000 } : clip)) }
      )
    };
    expect(cuts(spaced)).toEqual([]);
  });

  it('takes the nearest cut within reach of the playhead, and none outside it', () => {
    const timeline = twoClips();
    expect(cutNearest(timeline, 2_100)?.toClipId).toBe('clip-b');
    expect(cutNearest(timeline, 1_800)?.toClipId).toBe('clip-b');
    // Far enough away that the person was pointing at something else.
    expect(cutNearest(timeline, 900)).toBeNull();
  });
});

describe('setting a transition', () => {
  it('puts one on the cut and takes it off again', () => {
    const timeline = withTransition('fade');
    const cut = cuts(timeline)[0]!;
    expect(transitionForCut(timeline, cut)?.type).toBe('fade');
    expect(transitionForCut(removeTransitionAtCut(timeline, cut), cut)).toBeNull();
  });

  it('refuses one longer than the clips it has to fit inside', () => {
    const timeline = twoClips();
    const cut = cuts(timeline)[0]!;
    expect(setTransitionAtCut(timeline, cut, { type: 'fade', durationMs: 5_000 })).toBeNull();
  });
});

describe('the exported graph', () => {
  const graphOf = (timeline: TimelineDocument): string => {
    const { args } = compileFfmpegTimeline({
      timeline,
      assetPaths: new Map([
        ['asset-a', '/tmp/a.mp4'],
        ['asset-b', '/tmp/b.mp4']
      ]),
      outputPath: '/tmp/out.mp4',
      width: 320,
      height: 240,
      frameRate: 24
    });
    return args[args.indexOf('-filter_complex') + 1] ?? '';
  };

  it('ramps the clips either side of a fade', () => {
    const graph = graphOf(withTransition('fade'));
    // Out over the first half of the window, in over the second — the timing the
    // program monitor already draws.
    expect(graph).toContain('fade=t=out:st=1.75:d=0.25:alpha=1');
    expect(graph).toContain('fade=t=in:st=2:d=0.25:alpha=1');
  });

  it('scales the clip opacity rather than replacing it', () => {
    // A clip held at half opacity still dips to nothing, and comes back to half.
    const graph = graphOf(withTransition('crossfade'));
    expect(graph).toContain('colorchannelmixer=aa=1,fade=t=out');
  });

  it('draws a dip to black over the finished picture, not inside one clip', () => {
    const graph = graphOf(withTransition('dipToBlack'));
    expect(graph).toContain('[dip-source-0]');
    expect(graph).toContain('[video-dip-0]');
    // The clips keep their own opacity; the black layer is what moves.
    expect(graph).not.toContain('fade=t=out:st=1.75');
  });

  it('leaves a timeline without transitions exactly as it was', () => {
    expect(graphOf(twoClips())).not.toContain('fade=');
  });
});

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('a rendered transition', () => {
  it('actually darkens the frame at the cut', async () => {
    const discovery = await discoverFfmpeg();
    if (discovery.kind === 'unavailable') throw new Error(discovery.reason);

    directory = await mkdtemp(join(tmpdir(), 'openscene-transition-'));
    const first = join(directory, 'a.mp4');
    const second = join(directory, 'b.mp4');
    const outputPath = join(directory, 'out.mp4');
    // Two solid, bright sources, so "the frame went dark" cannot come from the
    // material itself.
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=white:s=64x48:r=24:d=2', '-pix_fmt', 'yuv420p', '-y', first
    ]);
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=white:s=64x48:r=24:d=2', '-pix_fmt', 'yuv420p', '-y', second
    ]);

    const { args } = compileFfmpegTimeline({
      timeline: withTransition('fade', 800),
      assetPaths: new Map([
        ['asset-a', first],
        ['asset-b', second]
      ]),
      outputPath,
      width: 64,
      height: 48,
      frameRate: 24
    });
    await execFileAsync(discovery.executablePath, args);

    /** Mean luminance of the frame at a moment, read out of the rendered file. */
    const luminanceAt = async (seconds: number, path = outputPath): Promise<number> => {
      const { stderr } = await execFileAsync(discovery.executablePath, [
        '-hide_banner', '-v', 'info',
        '-ss', String(seconds), '-i', path, '-frames:v', '1',
        '-vf', 'signalstats,metadata=print', '-f', 'null', '-'
      ]).catch((error: { stderr?: string }) => ({ stdout: '', stderr: error.stderr ?? '' }));
      const match = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/.exec(stderr);
      return match === null ? Number.NaN : Number(match[1]);
    };

    const away = await luminanceAt(0.5);
    const atCut = await luminanceAt(2);

    expect(away).toBeGreaterThan(150);
    // Fully faded at the cut: white went to the black underneath it.
    expect(atCut).toBeLessThan(40);

    // The dip is a separate path through the graph — a black layer over the
    // finished picture rather than a ramp inside a clip — so it is rendered too
    // rather than assumed to work because the fade does.
    const dipOutput = join(directory, 'dip.mp4');
    const dip = compileFfmpegTimeline({
      timeline: withTransition('dipToBlack', 800),
      assetPaths: new Map([
        ['asset-a', first],
        ['asset-b', second]
      ]),
      outputPath: dipOutput,
      width: 64,
      height: 48,
      frameRate: 24
    });
    await execFileAsync(discovery.executablePath, dip.args);
    expect(await luminanceAt(0.5, dipOutput)).toBeGreaterThan(150);
    expect(await luminanceAt(2, dipOutput)).toBeLessThan(40);
  }, 60_000);
});

/**
 * The other three renderers.
 *
 * A transition that only FFmpeg understands is the same bug in a smaller shape,
 * so the plan carries it, the bridge forwards it, and both native modules draw
 * it. The plan reduces all three types to one thing — black over the picture —
 * because adjacent clips genuinely cannot dissolve, and every renderer agreeing
 * on that is worth more than each deriving it.
 */
describe('what the phone is told', () => {
  it('turns each transition into a dip centred on the cut', () => {
    const plan = buildCompositionPlan({
      timeline: withTransition('crossfade', 600),
      width: 320,
      height: 240,
      frameRate: 24
    });
    expect(plan.dips).toEqual([{ startMs: 1_700, durationMs: 600 }]);
  });

  it('has none when nothing was set', () => {
    expect(buildCompositionPlan({ timeline: twoClips(), width: 320, height: 240, frameRate: 24 }).dips).toEqual([]);
  });

  it('is forwarded by the bridge rather than recomputed or dropped', async () => {
    const bridge = await readFile(new URL('../mobile/src/lib/exportComposition.ts', import.meta.url), 'utf8');
    expect(bridge).toContain('dips: plan.dips.map(');
  });

  it('is drawn by both native modules', async () => {
    const kotlin = await readFile(
      new URL('../mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt', import.meta.url),
      'utf8'
    );
    // A black overlay whose alpha rises and falls, because Media3 has no
    // cross-dissolve and does not need one for clips that never overlap.
    expect(kotlin).toContain('private fun dipOverlay(');
    expect(kotlin).toContain('setAlphaScale(alpha)');

    const swift = await readFile(new URL('../mobile/modules/video-export/ios/VideoComposer.swift', import.meta.url), 'utf8');
    expect(swift).toContain('setOpacityRamp(');
  });
});
