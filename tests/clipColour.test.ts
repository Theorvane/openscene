import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { NEUTRAL_COLOUR, clipColour, isGraded } from '../src/shared/clipColour';
import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { DEFAULT_CLIP_EFFECTS, type ClipEffects, type TimelineDocument } from '../src/shared/timelineTypes';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';

const execFileAsync = promisify(execFile);

/**
 * Colour on a clip.
 *
 * The neutral case carries as much weight as the graded one: it has to render
 * identically on every renderer, because that is what lets iOS not have the
 * feature yet without changing anybody's export.
 */

function timelineWith(effects: Partial<ClipEffects>): TimelineDocument {
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
                sourceEndMs: 1_000,
                sourceDurationMs: 1_000,
                effects: { ...DEFAULT_CLIP_EFFECTS, ...effects },
                keyframes: []
              }
            ]
          }
    )
  } as TimelineDocument;
}

const graphOf = (timeline: TimelineDocument): string => {
  const { args } = compileFfmpegTimeline({
    timeline,
    assetPaths: new Map([['asset-a', '/tmp/a.mp4']]),
    outputPath: '/tmp/out.mp4',
    width: 64,
    height: 48,
    frameRate: 24
  });
  return args[args.indexOf('-filter_complex') + 1] ?? '';
};

describe('what colour a clip has', () => {
  it('reads an ungraded clip as neutral', () => {
    expect(clipColour(DEFAULT_CLIP_EFFECTS)).toEqual(NEUTRAL_COLOUR);
    expect(isGraded(DEFAULT_CLIP_EFFECTS)).toBe(false);
    expect(isGraded(undefined)).toBe(false);
  });

  it('notices any one of the three moving', () => {
    expect(isGraded({ ...DEFAULT_CLIP_EFFECTS, brightness: 0.2 })).toBe(true);
    expect(isGraded({ ...DEFAULT_CLIP_EFFECTS, contrast: 1.4 })).toBe(true);
    expect(isGraded({ ...DEFAULT_CLIP_EFFECTS, saturation: 0 })).toBe(true);
  });

  it('falls back to neutral for a value the validators would have refused', () => {
    // Reaching one here means something bypassed them, and neutral is the
    // answer that cannot make a picture worse.
    expect(clipColour({ ...DEFAULT_CLIP_EFFECTS, contrast: 99 }).contrast).toBe(NEUTRAL_COLOUR.contrast);
  });
});

describe('what is stored', () => {
  it('leaves the keys off a clip nobody graded, so old projects round-trip', () => {
    const document = JSON.parse(JSON.stringify(timelineWith({}))) as unknown;
    expect(JSON.stringify(parseTimelineDocument(document))).not.toContain('brightness');
  });

  it('accepts a grade it can render and refuses one it cannot', () => {
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWith({ saturation: 0 }))))).not.toBeNull();
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWith({ saturation: 9 }))))).toBeNull();
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWith({ brightness: -4 }))))).toBeNull();
  });
});

describe('the exported graph', () => {
  it('grades before it fades', () => {
    // A clip at half opacity and raised brightness is a brightened clip that is
    // then faded, not a faded clip that is then brightened.
    const graph = graphOf(timelineWith({ brightness: 0.2, opacity: 0.5 }));
    expect(graph).toMatch(/eq=brightness=0\.2[^,]*,colorchannelmixer=aa=0\.5/);
  });

  it('says nothing at all about a clip nobody graded', () => {
    // An `eq` that changes nothing still costs a pass over every frame.
    expect(graphOf(timelineWith({}))).not.toContain('eq=');
  });
});

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('a rendered grade', () => {
  it('actually changes the picture', async () => {
    const discovery = await discoverFfmpeg();
    if (discovery.kind === 'unavailable') throw new Error(discovery.reason);

    directory = await mkdtemp(join(tmpdir(), 'openscene-colour-'));
    const source = join(directory, 'source.mp4');
    // Mid grey, so brightening and desaturating both have somewhere to go.
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x808080:s=64x48:r=24:d=1', '-pix_fmt', 'yuv420p', '-y', source
    ]);

    const luminance = async (effects: Partial<ClipEffects>): Promise<number> => {
      const outputPath = join(directory as string, `out-${Math.round(Math.random() * 1e9)}.mp4`);
      const { args } = compileFfmpegTimeline({
        timeline: timelineWith(effects),
        assetPaths: new Map([['asset-a', source]]),
        outputPath,
        width: 64,
        height: 48,
        frameRate: 24
      });
      await execFileAsync(discovery.executablePath, args);
      const { stderr } = await execFileAsync(discovery.executablePath, [
        '-hide_banner', '-v', 'info', '-ss', '0.5', '-i', outputPath, '-frames:v', '1',
        '-vf', 'signalstats,metadata=print', '-f', 'null', '-'
      ]).catch((error: { stderr?: string }) => ({ stdout: '', stderr: error.stderr ?? '' }));
      const match = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/.exec(stderr);
      return match === null ? Number.NaN : Number(match[1]);
    };

    const neutral = await luminance({});
    const brightened = await luminance({ brightness: 0.3 });

    expect(neutral).toBeGreaterThan(100);
    expect(neutral).toBeLessThan(160);
    // Brightness is added, so the grey moves up and stays there.
    expect(brightened).toBeGreaterThan(neutral + 30);
  }, 60_000);
});

/**
 * Where the grade goes on each surface, and what each says about itself.
 *
 * Source assertions for the native modules, as everywhere else — except that
 * the FFmpeg path above renders and measures, and the iOS claim is the absence
 * of a feature rather than the presence of one, which is the easier thing to
 * check honestly.
 */
describe('the surfaces', () => {
  const readMobile = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');
  const readDesktop = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

  it('grades on Android with the effects Media3 already has', async () => {
    const kotlin = await readMobile(
      'modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    expect(kotlin).toContain('Brightness(segment.brightness)');
    // Media3 centres contrast on zero and takes saturation as a percentage
    // change; the plan centres both on one.
    expect(kotlin).toContain('Contrast(segment.contrast - 1f)');
    expect(kotlin).toContain('adjustSaturation((segment.saturation - 1f) * 100f)');
  });

  it('carries colour over the bridge rather than dropping it', async () => {
    const bridge = await readMobile('src/lib/exportComposition.ts');
    expect(bridge).toContain('brightness: segment.brightness');
    expect(bridge).toContain('saturation: segment.saturation');
  });

  it('grades on iOS through a compositor, because layer instructions cannot', async () => {
    // This is where iOS spent a release: the controls were shown disabled with
    // the reason, because `AVMutableVideoCompositionLayerInstruction` carries a
    // transform and an opacity and no colour at all. Drawing the frames through
    // Core Image is what makes the grade reachable, and it has to keep doing the
    // placement and the transition ramps the layer instructions were doing.
    const composer = await readMobile('modules/video-export/ios/VideoComposer.swift');
    expect(composer).toContain('AVVideoCompositing');
    expect(composer).toContain('CIColorControls');
    expect(composer).toContain('customVideoCompositorClass = GradingCompositor.self');
    // And only where it is needed: an ungraded export stays on AVFoundation's
    // own compositing rather than paying for a Core Image render per frame.
    expect(composer).toContain('request.videoSegments.contains(where: { !$0.colour.isNeutral })');

    // The bridge has to carry the three numbers into the module, or the
    // compositor grades by the defaults and nothing changes.
    const module = await readMobile('modules/video-export/ios/VideoExportModule.swift');
    expect(module).toContain('@Field var brightness: Double = 0');
    expect(module).toContain('ComposerColour(brightness: brightness, contrast: contrast, saturation: saturation)');

    // And the controls are no longer disabled on one platform.
    const screen = await readMobile('src/screens/EditScreen.tsx');
    expect(screen).not.toContain('not rendered on iOS yet');
    expect(screen).not.toContain("Platform.OS !== 'ios'");
  });

  it('admits the phone preview does not show a grade', async () => {
    // A preview that showed roughly the right brightness and nothing of
    // saturation would disagree with the file, which is the failure this editor
    // keeps being caught by.
    expect(await readMobile('src/screens/EditScreen.tsx')).toContain('The preview does not show it yet');
  });

  it('shows it on the desktop, where the monitor can', async () => {
    expect(await readDesktop('renderer/src/editor/ProgramMonitor.tsx')).toContain('effectCssFilter(');
    expect(await readDesktop('renderer/src/editor/clipEffectControls.ts')).toContain('saturate(');
  });
});
