import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore, DEFAULT_ASSET_IMPORT_LIMITS } from '../src/main/assetLibraryStore';
import { ProjectStore } from '../src/main/projectStore';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import { createSymlinkOrSkip } from './helpers/symlinkCapability';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-asset-library-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('asset library store', () => {
  it('given a main-owned media path, when imported, then an isolated deterministic copy is persisted without exposing an absolute path', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'camera.webm');
      await writeFile(sourcePath, Buffer.from([1, 2, 3]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Asset copy' });
      const assets = new AssetLibraryStore(root, projects);

      // When
      const imported = await assets.import(
        {
          projectId: project.id,
          sourcePath,
          displayName: 'Camera take',
          kind: 'video',
          mimeType: 'video/webm'
        },
        new Date('2026-07-20T10:00:00.000Z')
      );
      await writeFile(sourcePath, Buffer.from([9, 9, 9]));
      const playback = await assets.getPlaybackSource(project.id, imported.id);
      const reopened = await new ProjectStore(root).open(project.id);

      // Then
      expect(imported.projectRelativePath).toBe(`assets/${imported.id}/original.webm`);
      expect(imported.byteLength).toBe(3);
      expect(imported.metadata).toBeNull();
      expect(JSON.stringify(imported)).not.toContain(directory);
      expect(playback?.mimeType).toBe('video/webm');
      await expect(readFile(playback?.filePath ?? '')).resolves.toEqual(Buffer.from([1, 2, 3]));
      expect(reopened?.assets).toEqual([imported]);
    });
  });

  it('given imported media, when browser metadata is updated, then metadata and project timestamp persist across reopen', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'narration.mp3');
      await writeFile(sourcePath, Buffer.from([4, 5]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Metadata' }, new Date('2026-07-20T10:00:00.000Z'));
      const assets = new AssetLibraryStore(root, projects);
      const imported = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Narration',
        kind: 'audio',
        mimeType: 'audio/mpeg'
      });

      // When
      const updated = await assets.updateMetadata(
        { projectId: project.id, assetId: imported.id, durationMs: 2_500 },
        new Date('2026-07-20T10:02:00.000Z')
      );

      // Then
      expect(updated.metadata).toEqual({ durationMs: 2_500 });
      expect(updated.updatedAt).toBe('2026-07-20T10:02:00.000Z');
      expect((await new ProjectStore(root).open(project.id))?.updatedAt).toBe('2026-07-20T10:02:00.000Z');
      await expect(assets.updateMetadata({ projectId: project.id, assetId: 'missing', durationMs: 1 })).rejects.toThrow(
        'Asset missing was not found.'
      );
    });
  });

  it('given files that are unsafe or unsupported, when import is attempted, then every source is rejected and no asset is registered', async ({ skip }) => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const regularPath = join(directory, 'take.webm');
      const symlinkPath = join(directory, 'linked.webm');
      const directoryPath = join(directory, 'folder.webm');
      const oversizedPath = join(directory, 'large.mp4');
      const unsupportedPath = join(directory, 'take.txt');
      await writeFile(regularPath, Buffer.from([1]));
      await writeFile(unsupportedPath, Buffer.from([1]));
      if (!(await createSymlinkOrSkip(regularPath, symlinkPath, skip))) return;
      await mkdir(directoryPath);
      await writeFile(oversizedPath, Buffer.from([1]));
      await truncate(oversizedPath, DEFAULT_ASSET_IMPORT_LIMITS.maximumFileBytes + 1);
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Rejected imports' });
      const assets = new AssetLibraryStore(root, projects);
      const base = { projectId: project.id, displayName: 'Take', kind: 'video' as const, mimeType: 'video/webm' };

      // When / Then
      await expect(assets.import({ ...base, sourcePath: join(directory, 'missing.webm') })).rejects.toThrow();
      await expect(assets.import({ ...base, sourcePath: 'relative.webm' })).rejects.toThrow(
        'Asset source path must be absolute and normalized.'
      );
      await expect(assets.import({ ...base, sourcePath: directoryPath })).rejects.toThrow('Asset source must be a regular file.');
      await expect(assets.import({ ...base, sourcePath: symlinkPath })).rejects.toThrow('Asset source cannot be a symbolic link.');
      await expect(assets.import({ ...base, sourcePath: unsupportedPath })).rejects.toThrow(
        'A selected media file is not supported.'
      );
      await expect(assets.import({ ...base, sourcePath: regularPath, mimeType: 'audio/webm' })).rejects.toThrow(
        'A selected media file is not supported.'
      );
      await expect(
        assets.import({ ...base, sourcePath: oversizedPath, mimeType: 'video/mp4' })
      ).rejects.toThrow(`A selected media file exceeds the ${DEFAULT_ASSET_IMPORT_LIMITS.maximumFileBytes} byte limit.`);
      await expect(assets.import({ ...base, sourcePath: regularPath, projectId: '../escape' })).rejects.toThrow(
        'Invalid project id.'
      );
      expect((await projects.open(project.id))?.assets).toEqual([]);
    });
  });

  it('given an imported audio asset, when timelines reference it, then known matching metadata and bounded source times are required', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'music.wav');
      await writeFile(sourcePath, Buffer.from([8, 7, 6]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Asset relation' });
      const assets = new AssetLibraryStore(root, projects);
      const asset = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Music',
        kind: 'audio',
        mimeType: 'audio/wav'
      });
      const clip = {
        id: 'clip-1',
        assetId: asset.id,
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        sourceDurationMs: 1_000,
        effects: DEFAULT_CLIP_EFFECTS,
        keyframes: []
      };
      const videoTimeline = {
        schemaVersion: 3 as const,
        tracks: [{ id: 'video-track-1', name: 'Video 1', kind: 'video' as const, clips: [clip] }],
        transitions: []
      };
      const audioTrack = {
        id: 'audio-track-1',
        name: 'Audio 1',
        kind: 'audio' as const,
        clips: [clip],
        mix: DEFAULT_AUDIO_TRACK_MIX
      };
      const audioTimeline = {
        schemaVersion: 3 as const,
        tracks: [audioTrack],
        transitions: []
      };
      const oversizedTimeline = {
        ...audioTimeline,
        tracks: [{ ...audioTrack, clips: [{ ...clip, sourceEndMs: 1_001, sourceDurationMs: 1_001 }] }]
      };
      const inconsistentDurationTimeline = {
        ...audioTimeline,
        tracks: [{ ...audioTrack, clips: [{ ...clip, sourceDurationMs: 2_000 }] }]
      };

      // When / Then
      await expect(projects.saveTimeline(project.id, audioTimeline)).rejects.toThrow(
        'Timeline clip clip-1 requires known asset metadata.'
      );
      await assets.updateMetadata({ projectId: project.id, assetId: asset.id, durationMs: 1_000 });
      await expect(projects.saveTimeline(project.id, videoTimeline)).rejects.toThrow(
        'Timeline clip clip-1 references an unavailable video asset.'
      );
      await expect(projects.saveTimeline(project.id, oversizedTimeline)).rejects.toThrow(
        'Timeline clip clip-1 exceeds its asset duration.'
      );
      await expect(projects.saveTimeline(project.id, inconsistentDurationTimeline)).rejects.toThrow(
        'Timeline clip clip-1 has inconsistent asset duration.'
      );
      await expect(projects.saveTimeline(project.id, audioTimeline)).resolves.toMatchObject({ timeline: audioTimeline });
    });
  });

  it('given a copied file replaced by a symlink, when playback is resolved, then lookup fails closed', async ({ skip }) => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.webm');
      await writeFile(sourcePath, Buffer.from([1]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Playback lookup' });
      const assets = new AssetLibraryStore(root, projects);
      const asset = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Take',
        kind: 'video',
        mimeType: 'video/webm'
      });
      const playback = await assets.getPlaybackSource(project.id, asset.id);
      const outsidePath = join(directory, 'outside.webm');
      await writeFile(outsidePath, Buffer.from([2]));
      await rm(playback?.filePath ?? '');
      if (!(await createSymlinkOrSkip(outsidePath, playback?.filePath ?? '', skip))) return;

      // When / Then
      await expect(assets.getPlaybackSource(project.id, asset.id)).resolves.toBeNull();
      await expect(assets.getPlaybackSource(project.id, 'missing')).resolves.toBeNull();
      await expect(stat(outsidePath)).resolves.toMatchObject({ size: 1 });
    });
  });

  it('given a project containing an imported asset, when deleted, then its copied asset directory is removed', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.webm');
      await writeFile(sourcePath, Buffer.from([1]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Populated delete' });
      const assets = new AssetLibraryStore(root, projects);
      const asset = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Take',
        kind: 'video',
        mimeType: 'video/webm'
      });
      const playback = await assets.getPlaybackSource(project.id, asset.id);

      // When
      const deleted = await projects.delete(project.id);

      // Then
      expect(deleted).toBe(true);
      await expect(stat(playback?.filePath ?? '')).rejects.toThrow();
      await expect(projects.open(project.id)).resolves.toBeNull();
    });
  });

});
