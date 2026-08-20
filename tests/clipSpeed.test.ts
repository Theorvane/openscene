import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { splitClip, trimClipLeft, trimClipRight, updateClipEffects } from '../src/shared/timelineClipLogic';
import { isValidClipEffects } from '../src/shared/timelineEffects';
import { clipDurationMs, clipSourceSpanMs, clipSpeed, sourceTimeMsAt } from '../src/shared/timelineClipGeometry';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument } from '../src/shared/timelineTypes';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';

const execFileAsync = promisify(execFile);

/**
 * A clip that plays faster or slower than it was shot.
 *
 * The interesting part is not the field, it is that a clip's length on the
 * timeline stopped being the same number as its window into the source. Those
 * were the same subtraction, written by hand in eight files, and every one of
 * them decided where clips sit or where a cut lands.
 */

function timelineWithSpeed(speed: number | undefined): TimelineDocument {
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
                sourceEndMs: 4_000,
                sourceDurationMs: 4_000,
                effects: speed === undefined ? { ...DEFAULT_CLIP_EFFECTS } : { ...DEFAULT_CLIP_EFFECTS, speed },
                keyframes: []
              }
            ]
          }
    )
  } as TimelineDocument;
}

const clipOf = (timeline: TimelineDocument) => timeline.tracks.find((track) => track.kind === 'video')!.clips[0]!;

describe('how long a clip is', () => {
  it('separates the source window from the time on the timeline', () => {
    const fast = clipOf(timelineWithSpeed(2));
    expect(clipSourceSpanMs(fast)).toBe(4_000);
    expect(clipDurationMs(fast)).toBe(2_000);

    const slow = clipOf(timelineWithSpeed(0.5));
    expect(clipSourceSpanMs(slow)).toBe(4_000);
    expect(clipDurationMs(slow)).toBe(8_000);
  });

  it('reads an absent speed as 1, which is every project written before this', () => {
    const clip = clipOf(timelineWithSpeed(undefined));
    expect(clip.effects.speed).toBeUndefined();
    expect(clipSpeed(clip)).toBe(1);
    expect(clipDurationMs(clip)).toBe(clipSourceSpanMs(clip));
  });

  it('refuses a rate that would be a division by zero rather than slow motion', () => {
    expect(clipSpeed({ ...clipOf(timelineWithSpeed(2)), effects: { ...DEFAULT_CLIP_EFFECTS, speed: 0 } })).toBe(1);
  });
});

describe('editing a retimed clip', () => {
  it('converts timeline milliseconds into source ones when trimming', () => {
    // Dragging the head of a 2× clip one second later consumes two seconds of
    // the file, not one.
    const timeline = timelineWithSpeed(2);
    const trimmed = trimClipLeft(timeline, { clipId: 'clip-a', timelineStartMs: 1_000 });
    expect(clipOf(trimmed as TimelineDocument).sourceStartMs).toBe(2_000);
  });

  it('does the same when trimming the tail', () => {
    const trimmed = trimClipRight(timelineWithSpeed(2), { clipId: 'clip-a', timelineEndMs: 1_000 });
    expect(clipOf(trimmed as TimelineDocument).sourceEndMs).toBe(2_000);
  });

  it('splits at the source moment the playhead is actually over', () => {
    const split = splitClip(timelineWithSpeed(2), { clipId: 'clip-a', atMs: 500, rightClipId: 'clip-b' });
    const clips = (split as TimelineDocument).tracks.find((track) => track.kind === 'video')!.clips;
    expect(clips[0]?.sourceEndMs).toBe(1_000);
    expect(clips[1]?.sourceStartMs).toBe(1_000);
    // The two halves still cover the whole clip and nothing more.
    expect(clipDurationMs(clips[0]!) + clipDurationMs(clips[1]!)).toBe(2_000);
  });

  it('maps a timeline moment into the source', () => {
    expect(sourceTimeMsAt(clipOf(timelineWithSpeed(0.5)), 2_000)).toBe(1_000);
  });
});

describe('retiming a clip that a transition sits on', () => {
  /*
    The failure this guards against was not a wrong number, it was an
    unopenable project.

    A transition is only valid while its two clips touch. Retiming the first one
    made it shorter, the cut moved, and `updateClipEffects` — which wrote the
    new effects straight into the track, because until speed no effect could
    change a clip's length — left the transition behind. The file was written,
    the validator refused the whole document on the next read, and the editor
    came back with no project at all.
  */
  function twoTouchingClips(): TimelineDocument {
    const base = timelineWithSpeed(undefined);
    return {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              clips: [
                track.clips[0]!,
                { ...track.clips[0]!, id: 'clip-b', timelineStartMs: 4_000, sourceStartMs: 0, sourceEndMs: 4_000 }
              ]
            }
      ),
      transitions: [{ fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', durationMs: 500 }]
    } as TimelineDocument;
  }

  it('drops the transition rather than writing a document that cannot be read back', () => {
    const retimed = updateClipEffects(twoTouchingClips(), { clipId: 'clip-a', effects: { speed: 2 } });
    expect(retimed).not.toBeNull();
    // The clips no longer touch, so the transition cannot survive — but the
    // project still opens, which is the part that matters.
    expect(retimed?.transitions).toEqual([]);
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(retimed)))).not.toBeNull();
  });

  it('keeps a transition that is still valid', () => {
    const dimmed = updateClipEffects(twoTouchingClips(), { clipId: 'clip-a', effects: { opacity: 0.5 } });
    expect(dimmed?.transitions).toHaveLength(1);
  });
});

describe('a transition on a retimed clip', () => {
  it('fades from where the clip actually ends, not from where its source would', () => {
    // A 4s source at 2× ends at 2s on the timeline. A fade timed from the source
    // span would start after the picture had already gone.
    const base = timelineWithSpeed(2);
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              clips: [
                track.clips[0]!,
                { ...track.clips[0]!, id: 'clip-b', timelineStartMs: 2_000, sourceStartMs: 0, sourceEndMs: 4_000 }
              ]
            }
      ),
      transitions: [{ fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', durationMs: 500 }]
    } as TimelineDocument;

    const { args } = compileFfmpegTimeline({
      timeline,
      assetPaths: new Map([['asset-a', '/tmp/a.mp4']]),
      outputPath: '/tmp/out.mp4',
      width: 320,
      height: 240,
      frameRate: 24
    });
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain('fade=t=out:st=1.75:d=0.25:alpha=1');
  });
});

describe('why a retime is refused', () => {
  /*
    Speed is the first effect that can be refused for a reason that has nothing
    to do with its value.

    Slowing a clip makes it longer, which can run it into its neighbour, and the
    shared rule answers `null` to that exactly as it answers `null` to a rate
    out of range. Being told "that value is outside what the effect accepts"
    while looking at 1.75×, which is plainly inside the range, is the editor
    lying about its own rules — so both surfaces work out which refusal it was.
  */
  it('refuses a slower clip that would collide, while the rate itself is valid', () => {
    const base = timelineWithSpeed(2);
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              // Clip A occupies 0–2000 at 2×; the next clip starts right after.
              clips: [
                track.clips[0]!,
                { ...track.clips[0]!, id: 'clip-b', timelineStartMs: 2_100, sourceStartMs: 0, sourceEndMs: 4_000 }
              ]
            }
      )
    } as TimelineDocument;

    const slower = { ...DEFAULT_CLIP_EFFECTS, speed: 1.75 };
    // The values are fine...
    expect(isValidClipEffects(slower)).toBe(true);
    // ...and the edit is still refused, because 4s at 1.75× is 2.29s and the
    // neighbour is 2.1s away.
    expect(updateClipEffects(timeline, { clipId: 'clip-a', effects: { speed: 1.75 } })).toBeNull();
  });

  it('accepts the same rate once there is room', () => {
    const base = timelineWithSpeed(2);
    const timeline: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              clips: [
                track.clips[0]!,
                { ...track.clips[0]!, id: 'clip-b', timelineStartMs: 6_000, sourceStartMs: 0, sourceEndMs: 4_000 }
              ]
            }
      )
    } as TimelineDocument;
    expect(updateClipEffects(timeline, { clipId: 'clip-a', effects: { speed: 1.75 } })).not.toBeNull();
  });

  it('is said out loud on both surfaces', async () => {
    const room = 'A slower clip needs more room';
    const mobile = await readFile(new URL('../mobile/src/lib/editorState.ts', import.meta.url), 'utf8');
    const desktop = await readFile(new URL('../src/renderer/src/editor/useTimelineEditor.ts', import.meta.url), 'utf8');
    expect(mobile).toContain(room);
    expect(desktop).toContain(room);
  });
});

describe('what is stored', () => {
  it('keeps the key off a clip that plays at its own rate, so old projects round-trip', () => {
    const document = JSON.parse(JSON.stringify(timelineWithSpeed(undefined))) as unknown;
    const parsed = parseTimelineDocument(document);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('speed');
  });

  it('accepts a rate it can render and refuses one it cannot', () => {
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWithSpeed(2))))).not.toBeNull();
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWithSpeed(100))))).toBeNull();
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(timelineWithSpeed(0))))).toBeNull();
  });
});

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('a rendered retime', () => {
  it('produces a file of the length the timeline promised, with its sound retimed too', async () => {
    const discovery = await discoverFfmpeg();
    if (discovery.kind === 'unavailable') throw new Error(discovery.reason);

    directory = await mkdtemp(join(tmpdir(), 'openscene-speed-'));
    const source = join(directory, 'source.mp4');
    const outputPath = join(directory, 'out.mp4');
    // Four seconds of picture with a tone under it, so both halves of the
    // retime can be checked rather than assumed from the video alone.
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-pix_fmt', 'yuv420p', '-shortest', '-y', source
    ]);

    const { args } = compileFfmpegTimeline({
      timeline: timelineWithSpeed(2),
      assetPaths: new Map([['asset-a', source]]),
      audibleAssetIds: new Set(['asset-a']),
      outputPath,
      width: 64,
      height: 48,
      frameRate: 24
    });
    await execFileAsync(discovery.executablePath, args);

    const read = async (stream: 'v' | 'a'): Promise<number> => {
      const { stdout } = await execFileAsync(discovery.executablePath.replace(/ffmpeg$/, 'ffprobe'), [
        '-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration', '-of', 'csv=p=0', outputPath
      ]);
      return Number(stdout.trim().split('\n')[0]);
    };

    // Four seconds of source at 2× is two seconds of cut. A tenth either way is
    // frame quantisation, not a retime that did not happen.
    expect(await read('v')).toBeGreaterThan(1.9);
    expect(await read('v')).toBeLessThan(2.1);
    // And the sound came with it, rather than running two seconds long behind a
    // picture that had already finished.
    expect(await read('a')).toBeLessThan(2.2);
  }, 60_000);
});

/**
 * The phone renderers, and the bridge between them.
 *
 * Source assertions, which are weak — but the failure they guard against is the
 * one this codebase has had three times: a value computed by the shared plan and
 * dropped before it reached anything that draws.
 */
describe('what the phone is told', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('carries the rate on both picture and sound', async () => {
    const bridge = await read('src/lib/exportComposition.ts');
    expect(bridge).toContain('speed: segment.speed');
    expect(bridge).toContain('gain: segment.gain, speed: segment.speed');
  });

  it('retimes both on Android', async () => {
    const kotlin = await read('modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt');
    expect(kotlin).toContain('SpeedChangeEffect(');
    // Sonic, so the sound is retimed rather than left running behind a picture
    // that has already finished.
    expect(kotlin).toContain('SonicAudioProcessor()');
  });

  it('retimes both on iOS', async () => {
    const swift = await read('modules/video-export/ios/VideoExportModule.swift');
    // Once for the picture, once for the sound.
    expect(swift.match(/scaleTimeRange\(/g)?.length).toBe(2);
  });
});
