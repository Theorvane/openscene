import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { resolveTimelineTrackForAsset } from '../src/shared/timelineClipPlacement';
import { STILL_DEFAULT_HOLD_MS, stillClipSource, trackKindForAsset } from '../src/shared/timelineStills';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import type { MediaAsset, TimelineDocument } from '../src/shared/timelineTypes';

const execFileAsync = promisify(execFile);

/**
 * A still is picture with no timeline of its own. The rule that matters is that
 * it is held for the length of its clip rather than seeked into, and the only
 * way to know FFmpeg agrees is to run it.
 */

const still: MediaAsset = {
  id: 'asset-still',
  displayName: 'A still',
  projectRelativePath: 'media/still.png',
  kind: 'image',
  mimeType: 'image/png',
  byteLength: 0,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

function timelineWithStill(holdMs: number): TimelineDocument {
  const base = createInitialTimeline();
  const target = resolveTimelineTrackForAsset(base, still);
  if (!target.ok) throw new Error(target.error);
  return {
    ...base,
    tracks: base.tracks.map((track) =>
      track.id !== target.track.id
        ? track
        : {
            ...track,
            clips: [
              {
                id: 'clip-still',
                assetId: still.id,
                timelineStartMs: 0,
                ...stillClipSource(holdMs),
                effects: { ...DEFAULT_CLIP_EFFECTS },
                keyframes: []
              }
            ]
          }
    )
  } as TimelineDocument;
}

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('a still on the timeline', () => {
  it('goes on a video track, because a still is picture', () => {
    expect(trackKindForAsset('image')).toBe('video');
    const target = resolveTimelineTrackForAsset(createInitialTimeline(), still);
    expect(target.ok).toBe(true);
    if (target.ok) expect(target.track.kind).toBe('video');
  });

  it('is accepted by the ordinary clip validators without being taught about', () => {
    // The hold is both the clip's length and its source's, so the check that a
    // clip may not run past its source is satisfied rather than special-cased.
    const document = timelineWithStill(STILL_DEFAULT_HOLD_MS);
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(document)))).not.toBeNull();
  });

  it('is held rather than opened as a movie', () => {
    const { args } = compileFfmpegTimeline({
      timeline: timelineWithStill(4_000),
      assetPaths: new Map([[still.id, '/tmp/still.png']]),
      stillAssetIds: new Set([still.id]),
      outputPath: '/tmp/out.mp4',
      width: 320,
      height: 240,
      frameRate: 24
    });

    const input = args.indexOf('/tmp/still.png');
    expect(input).toBeGreaterThan(0);
    // `-loop 1 -t <seconds>` immediately precedes the input it applies to.
    expect(args.slice(input - 5, input)).toEqual(['-loop', '1', '-t', '4', '-i']);
  });

  it('is opened as a movie when nothing says it is a still', () => {
    // Every project written before stills existed passes no set at all.
    const { args } = compileFfmpegTimeline({
      timeline: timelineWithStill(4_000),
      assetPaths: new Map([[still.id, '/tmp/still.png']]),
      outputPath: '/tmp/out.mp4',
      width: 320,
      height: 240,
      frameRate: 24
    });
    expect(args).not.toContain('-loop');
  });

  it('renders to a video of the length it was held for', async () => {
    const discovery = await discoverFfmpeg();
    if (discovery.kind === 'unavailable') throw new Error(discovery.reason);

    directory = await mkdtemp(join(tmpdir(), 'still-export-'));
    const stillPath = join(directory, 'still.png');
    const outputPath = join(directory, 'out.mp4');
    // A 2×2 red PNG, written by FFmpeg so the test does not carry a binary.
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=2x2:d=1', '-frames:v', '1', '-y', stillPath
    ]);

    const { args } = compileFfmpegTimeline({
      timeline: timelineWithStill(2_000),
      assetPaths: new Map([[still.id, stillPath]]),
      stillAssetIds: new Set([still.id]),
      outputPath,
      width: 320,
      height: 240,
      frameRate: 24
    });
    await execFileAsync(discovery.executablePath, args);

    const { stdout } = await execFileAsync(discovery.executablePath.replace(/ffmpeg$/, 'ffprobe'), [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outputPath
    ]).catch(async () => {
      // ffprobe is not always beside ffmpeg; fall back to decoding the output.
      const probe = await execFileAsync(discovery.executablePath, ['-hide_banner', '-i', outputPath, '-f', 'null', '-'])
        .catch((error: { stderr?: string }) => ({ stdout: '', stderr: error.stderr ?? '' }));
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(probe.stderr);
      const total = match === null ? '0' : String(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
      return { stdout: total, stderr: '' };
    });

    // A still opened as a movie yields one frame — about 0.04s at 24fps — so
    // anything near the two seconds asked for proves it was held.
    expect(Number(stdout.trim())).toBeGreaterThan(1.5);
  });
});
