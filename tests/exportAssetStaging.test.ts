import { mkdir, open, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { removeExportStaging, stageExportAssets } from '../src/main/exportAssetStaging';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { LocalProjectSnapshot } from '../src/shared/timelineTypes';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';

describe('export asset staging', () => {
  it('copies from the validated open handle when the source path is replaced before staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-staging-'));
    const exportsRoot = join(root, 'exports');
    const sourcePath = join(root, 'source.webm');
    const movedPath = join(root, 'original.webm');
    await writeFile(sourcePath, 'safe');
    await mkdir(exportsRoot);
    const project: LocalProjectSnapshot = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: 'project_01',
      name: 'Project',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      assets: [],
      ai: createEmptyAiProjectDocument(),
      timeline: {
        schemaVersion: TIMELINE_SCHEMA_VERSION,
        tracks: [{
          id: 'video-track', name: 'Video', kind: 'video', clips: [{
            id: 'clip_01', assetId: 'asset_01', timelineStartMs: 0, sourceStartMs: 0,
            sourceEndMs: 1_000, sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
          }]
        }],
        transitions: []
      }
    };
    const staged = await stageExportAssets({
      exportsRoot,
      jobId: 'export_01',
      project,
      assets: {
        openPlaybackSource: async () => {
          const file = await open(sourcePath, 'r');
          await rename(sourcePath, movedPath);
          await writeFile(sourcePath, 'evil');
          return { file, filePath: sourcePath, mimeType: 'video/webm', byteLength: 4 };
        }
      }
    });
    const stagedPath = staged.assetPaths.get('asset_01');
    if (stagedPath === undefined) {
      throw new Error('Expected staged asset path.');
    }

    expect(await readFile(stagedPath, 'utf8')).toBe('safe');
    await removeExportStaging(staged.directory);
  });
});
