import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { applyCaptionPreset } from '../src/shared/captionStyle';
import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { createSubtitleSidecar } from '../src/shared/subtitleDelivery';
import { escapeFontPath, FILTER_LIST_ARGS, fontCandidates, supportsDrawtext } from '../src/shared/titleFont';
import { DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';

const execFileAsync = promisify(execFile);

async function installedFont(weight: 'regular' | 'bold'): Promise<string | null> {
  for (const candidate of fontCandidates(process.platform, weight)) {
    try { await access(candidate); return candidate; } catch { /* Try the next system face. */ }
  }
  return null;
}

describe('styled title FFmpeg render', () => {
  it('renders a real boxed bold caption without filter-graph errors', async () => {
    const runtime = await discoverFfmpeg({ environment: process.env, platform: process.platform });
    if (runtime.kind === 'unavailable') return;
    const filterListing = await execFileAsync(runtime.executablePath, [...FILTER_LIST_ARGS]);
    // The product performs this same capability preflight and refuses a title
    // export with a precise message. Homebrew's standard FFmpeg build currently
    // omits drawtext, while the Windows development build includes it.
    if (!supportsDrawtext(`${filterListing.stdout}\n${filterListing.stderr}`)) return;
    const regular = await installedFont('regular');
    const bold = await installedFont('bold');
    if (regular === null || bold === null) return;
    const root = await mkdtemp(join(tmpdir(), 'openscene-caption-style-'));
    try {
      const source = join(root, 'source.mp4');
      const output = join(root, 'styled.mp4');
      await execFileAsync(runtime.executablePath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
      const title = applyCaptionPreset({
        id: 'auto-caption-real-1', text: 'Xin chào', timelineStartMs: 0, timelineEndMs: 900,
        sizePx: 64, color: '#ffffff', positionX: 0, positionY: 0
      }, 'boxed');
      const timeline = {
        schemaVersion: TIMELINE_SCHEMA_VERSION, transitions: [], titles: [title],
        tracks: [{ id: 'video-1', name: 'Video 1', kind: 'video' as const, clips: [{
          id: 'clip-1', assetId: 'asset-1', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1_000, sourceDurationMs: 1_000,
          effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: []
        }] }]
      };
      const compiled = compileFfmpegTimeline({
        timeline, assetPaths: new Map([['asset-1', source]]), outputPath: output,
        width: 640, height: 360, frameRate: 30,
        titleFontPath: escapeFontPath(regular), titleBoldFontPath: escapeFontPath(bold)
      });
      await execFileAsync(runtime.executablePath, [...compiled.args], { timeout: 30_000 });
      expect((await stat(output)).size).toBeGreaterThan(0);

      const assPath = join(root, 'styled.ass');
      const assOutput = join(root, 'styled-ass.mp4');
      await writeFile(assPath, createSubtitleSidecar(timeline, 'ass').contents, 'utf8');
      await execFileAsync(runtime.executablePath, [
        '-v', 'error', '-i', source, '-vf', `subtitles=filename='${escapeFontPath(assPath)}'`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', assOutput
      ], { timeout: 30_000 });
      expect((await stat(assOutput)).size).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
