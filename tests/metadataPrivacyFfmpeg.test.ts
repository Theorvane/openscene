import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { inspectContainerMetadata } from '../src/main/containerMetadataInspection';
import { ffprobePathFor } from '../src/main/exportMeasurement';
import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { verifyMetadataPrivacy } from '../src/shared/metadataPrivacy';
import { DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION, type TimelineDocument } from '../src/shared/timelineTypes';

const execFile = promisify(execFileCallback);

async function formatTags(ffprobePath: string, filePath: string): Promise<Record<string, string>> {
  const { stdout } = await execFile(ffprobePath, [
    '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath
  ], { maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
  return Object.fromEntries(Object.entries(parsed.format?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

describe('Privacy Clean FFmpeg delivery', () => {
  it('removes allowlisted personal tags from the output copy while preserving copyright', async () => {
    const discovered = await discoverFfmpeg();
    if (discovered.kind === 'unavailable') throw new Error(discovered.reason);
    const directory = await mkdtemp(join(tmpdir(), 'metadata-privacy-'));
    try {
      const sourcePath = join(directory, 'source.mp4');
      const preservePath = join(directory, 'preserve.mp4');
      const cleanPath = join(directory, 'clean.mp4');
      await execFile(discovered.executablePath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=1',
        '-metadata', 'title=Private title', '-metadata', 'artist=Creator Name',
        '-metadata', 'comment=Private note', '-metadata', 'copyright=Keep Rights',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'use_metadata_tags', sourcePath
      ]);
      const timeline: TimelineDocument = {
        schemaVersion: TIMELINE_SCHEMA_VERSION,
        tracks: [{ kind: 'video', id: 'track_01', name: 'Video', clips: [{
          id: 'clip_01', assetId: 'asset_01', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1_000,
          sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
        }] }],
        transitions: []
      };
      const common = {
        timeline, assetPaths: new Map([['asset_01', sourcePath]]), stillAssetIds: new Set<string>(),
        audibleAssetIds: new Set<string>(), width: 64, height: 64, frameRate: 10
      };
      await execFile(discovered.executablePath, [...compileFfmpegTimeline({
        ...common, outputPath: preservePath, metadataPrivacyMode: 'preserve_provenance'
      }).args]);
      await execFile(discovered.executablePath, [...compileFfmpegTimeline({
        ...common, outputPath: cleanPath, metadataPrivacyMode: 'privacy_clean'
      }).args]);

      const ffprobePath = ffprobePathFor(discovered.executablePath);
      const source = await formatTags(ffprobePath, sourcePath);
      const preserved = await formatTags(ffprobePath, preservePath);
      const cleaned = await formatTags(ffprobePath, cleanPath);
      expect(source).toMatchObject({ title: 'Private title', artist: 'Creator Name', comment: 'Private note', copyright: 'Keep Rights' });
      expect(preserved).toMatchObject({ title: 'Private title', artist: 'Creator Name', comment: 'Private note', copyright: 'Keep Rights' });
      expect(cleaned.title).toBeUndefined();
      expect(cleaned.artist).toBeUndefined();
      expect(cleaned.comment).toBeUndefined();
      expect(cleaned.copyright).toBe('Keep Rights');
      const before = await inspectContainerMetadata({ ffmpegPath: discovered.executablePath, filePath: sourcePath });
      const after = await inspectContainerMetadata({ ffmpegPath: discovered.executablePath, filePath: cleanPath });
      expect(before.fields.map((field) => field.key)).toEqual(['artist', 'comment', 'title']);
      expect(after).toEqual({ checked: true, fields: [] });
      expect(verifyMetadataPrivacy('privacy_clean', before, after)).toMatchObject({ checked: true, ok: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
