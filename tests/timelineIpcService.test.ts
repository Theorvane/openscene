import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { ProjectStore } from '../src/main/projectStore';
import { TimelineIpcService } from '../src/main/timelineIpcService';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-timeline-ipc-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('timeline IPC service', () => {
  it('given project requests, when handled through the IPC service, then path-free project responses are returned', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [workspace] })
      });

      // When
      const created = await service.createProject({ name: 'Cutdown' });
      if (!created.ok || created.value.cancelled) {
        throw new Error('Expected project creation to succeed.');
      }
      const project = created.value.project;
      const listed = await service.listProjects(undefined);
      const opened = await service.openProject({ projectId: project.id });
      const invalid = await service.openProject({ projectId: '../escape' });
      const deleted = await service.deleteProject({ projectId: project.id });

      // Then
      expect(listed).toEqual({
        ok: true,
        value: [{ id: project.id, name: 'Cutdown', createdAt: project.createdAt, updatedAt: project.updatedAt, storage: 'external', folderName: 'Cutdown' }]
      });
      expect(opened).toEqual({ ok: true, value: project });
      expect(invalid).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'The project lookup payload was not valid.' } });
      expect(deleted).toEqual({ ok: true, value: { deleted: true } });
      expect(JSON.stringify({ created, listed, opened, deleted })).not.toContain(directory);
    });
  });

  it('given a cancelled directory dialog, when a project is created, then a cancelled result is returned without touching disk', async () => {
    await withTempDirectory(async (directory) => {
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const service = new TimelineIpcService({ projects, assets: new AssetLibraryStore(join(directory, 'projects'), projects) });

      const created = await service.createProject({ name: 'Cutdown' });

      expect(created).toEqual({ ok: true, value: { cancelled: true } });
      expect(await projects.list()).toEqual([]);
    });
  });

  it('given a picked folder containing a project, when the folder is opened, then the project is registered and returned', async () => {
    await withTempDirectory(async (directory) => {
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const seedService = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [workspace] })
      });
      const created = await seedService.createProject({ name: 'Folder Cut' });
      if (!created.ok || created.value.cancelled) {
        throw new Error('Expected seed project creation to succeed.');
      }
      const projectFolder = join(workspace, 'Folder Cut');
      await projects.delete(created.value.project.id);
      expect(await projects.list()).toEqual([]);

      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [projectFolder] })
      });
      const reopened = await service.openProjectFolder(undefined);

      if (!reopened.ok || reopened.value.cancelled) {
        throw new Error('Expected the project folder to open.');
      }
      expect(reopened.value.project.id).toBe(created.value.project.id);
      expect((await projects.list()).map((summary) => summary.folderName)).toEqual(['Folder Cut']);
      expect(JSON.stringify(reopened)).not.toContain(directory);
    });
  });

  it('given a picked empty folder, when opened, then a project named after the folder is initialized there', async () => {
    await withTempDirectory(async (directory) => {
      const emptyFolder = join(directory, 'Fresh Cut');
      await mkdir(emptyFolder);
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [emptyFolder] })
      });

      const opened = await service.openProjectFolder(undefined);

      if (!opened.ok || opened.value.cancelled) {
        throw new Error('Expected the empty folder to become a project.');
      }
      expect(opened.value.created).toBe(true);
      expect(opened.value.project.name).toBe('Fresh Cut');
      await expect(readFile(join(emptyFolder, 'project.json'), 'utf8')).resolves.toContain(opened.value.project.id);
      expect(JSON.stringify(opened)).not.toContain(directory);
    });
  });

  it('given a picked folder with unrelated files, when opened, then a project is initialized there without touching the files', async () => {
    await withTempDirectory(async (directory) => {
      const cluttered = join(directory, 'Location Footage');
      await mkdir(cluttered);
      await writeFile(join(cluttered, 'notes.txt'), 'not a project');
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [cluttered] })
      });

      const opened = await service.openProjectFolder(undefined);

      if (!opened.ok || opened.value.cancelled) {
        throw new Error('Expected the folder to become a project.');
      }
      expect(opened.value.created).toBe(true);
      expect(opened.value.project.name).toBe('Location Footage');
      await expect(readFile(join(cluttered, 'notes.txt'), 'utf8')).resolves.toBe('not a project');
      expect(JSON.stringify(opened)).not.toContain(directory);
    });
  });

  it('given a picked folder with an unreadable project file, when opened, then a safe invalid-input error is returned and the file survives', async () => {
    await withTempDirectory(async (directory) => {
      const corrupt = join(directory, 'corrupt');
      await mkdir(corrupt);
      await writeFile(join(corrupt, 'project.json'), '{not valid json', 'utf8');
      const projects = new ProjectStore(
        join(directory, 'projects'),
        new ProjectLocationRegistry(join(directory, 'project-locations.json'))
      );
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => ({ canceled: false, filePaths: [corrupt] })
      });

      const opened = await service.openProjectFolder(undefined);

      expect(opened).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'The selected folder has a project file that could not be read, so it was left untouched.' } });
      await expect(readFile(join(corrupt, 'project.json'), 'utf8')).resolves.toBe('{not valid json');
    });
  });

  it('given a native dialog selection, when media is imported, then only selected regular media files are copied and no source path is returned', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const videoPath = join(directory, 'take.mp4');
      const audioPath = join(directory, 'song.mp3');
      await writeFile(videoPath, Buffer.from([1, 2]));
      await writeFile(audioPath, Buffer.from([3]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Import' });
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(root, projects),
        selectMediaFiles: async () => ({ canceled: false, filePaths: [videoPath, audioPath] })
      });

      // When
      const imported = await service.importProjectAssets({ projectId: project.id });

      // Then
      if (!imported.ok) {
        throw new Error(`Expected import to succeed: ${imported.error.code} ${imported.error.message}`);
      }
      expect(imported.value.assets).toHaveLength(2);
      expect(imported.value.assets.map((asset) => asset.displayName)).toEqual(['take.mp4', 'song.mp3']);
      expect(JSON.stringify(imported)).not.toContain(directory);
      await expect(readFile(join(root, project.id, imported.value.assets[0]?.projectRelativePath ?? ''))).resolves.toEqual(Buffer.from([1, 2]));
    });
  });

  it('given more than the allowed selected files, when import is requested, then the request is rejected before project mutation', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.mp4');
      await writeFile(sourcePath, Buffer.from([1]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Bounded import' });
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(root, projects),
        selectMediaFiles: async () => ({ canceled: false, filePaths: Array.from({ length: 101 }, () => sourcePath) })
      });

      // When
      const imported = await service.importProjectAssets({ projectId: project.id });

      // Then
      expect(imported).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'A maximum of 100 media files can be imported at once.' }
      });
      expect((await projects.open(project.id))?.assets).toEqual([]);
    });
  });

  it('given a later invalid selection, when a multi-file import fails, then earlier files and asset records are rolled back', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const validPath = join(directory, 'take.mp4');
      const invalidPath = join(directory, 'notes.txt');
      await writeFile(validPath, Buffer.from([1, 2]));
      await writeFile(invalidPath, Buffer.from([3]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Atomic import' });
      const service = new TimelineIpcService({
        projects,
        assets: new AssetLibraryStore(root, projects),
        selectMediaFiles: async () => ({ canceled: false, filePaths: [validPath, invalidPath] })
      });

      // When
      const imported = await service.importProjectAssets({ projectId: project.id });

      // Then
      expect(imported).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'A selected media file is not supported.' }
      });
      expect((await projects.open(project.id))?.assets).toEqual([]);
      await expect(readFile(join(root, project.id, 'assets'))).rejects.toThrow();
    });
  });

  it('given renderer-controlled import and metadata payloads, when invalid fields are included, then they are rejected', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Reject' });
      const service = new TimelineIpcService({ projects, assets: new AssetLibraryStore(root, projects) });

      // When / Then
      await expect(service.importProjectAssets({ projectId: project.id, sourcePath: join(directory, 'take.webm') })).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'The media import payload was not valid.' }
      });
      await expect(service.updateAssetMetadata({ projectId: project.id, assetId: 'asset-1', durationMs: 1, mimeType: 'video/webm' })).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'The asset metadata payload was not valid.' }
      });
      await expect(service.updateAssetMetadata({ projectId: project.id, assetId: 'asset-1', durationMs: Number.MAX_SAFE_INTEGER })).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'The asset metadata payload was not valid.' }
      });
    });
  });

  it('given project-owned assets, when timelines and playback URLs are requested, then authorization is enforced', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.webm');
      await writeFile(sourcePath, Buffer.from([1]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Timeline' });
      const assets = new AssetLibraryStore(root, projects);
      const service = new TimelineIpcService({ projects, assets });
      const asset = await assets.import({ projectId: project.id, sourcePath, displayName: 'Take', kind: 'video', mimeType: 'video/webm' });
      await assets.updateMetadata({ projectId: project.id, assetId: asset.id, durationMs: 1 });
      const validTimeline = {
        schemaVersion: 3 as const,
        tracks: [{ id: 'video-track-1', name: 'Video 1', kind: 'video' as const, clips: [{ id: 'clip-1', assetId: asset.id, timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1, sourceDurationMs: 1, effects: DEFAULT_CLIP_EFFECTS, keyframes: [] }] }],
        transitions: []
      };
      const videoTrack = validTimeline.tracks[0];
      if (videoTrack === undefined) {
        throw new Error('Expected timeline fixture to include a video track.');
      }
      const videoClip = videoTrack.clips[0];
      if (videoClip === undefined) {
        throw new Error('Expected timeline fixture to include a video clip.');
      }

      // When
      const saved = await service.saveTimeline({ projectId: project.id, timeline: validTimeline });
      const missingAssetTimeline = await service.saveTimeline({ projectId: project.id, timeline: { ...validTimeline, tracks: [{ ...videoTrack, clips: [{ ...videoClip, assetId: 'missing' }] }] } });
      const oversizedAssetTimeline = await service.saveTimeline({
        projectId: project.id,
        timeline: { ...validTimeline, tracks: [{ ...videoTrack, clips: [{ ...videoClip, sourceEndMs: 2, sourceDurationMs: 2 }] }] }
      });
      const playback = await service.getAssetPlaybackUrl({ projectId: project.id, assetId: asset.id });
      const missingPlayback = await service.getAssetPlaybackUrl({ projectId: project.id, assetId: 'missing' });

      // Then
      expect(saved).toMatchObject({ ok: true, value: { timeline: validTimeline } });
      expect(missingAssetTimeline).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Timeline clip clip-1 references an unavailable video asset.' } });
      expect(oversizedAssetTimeline).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Timeline clip clip-1 exceeds its asset duration.' } });
      expect(playback).toEqual({ ok: true, value: { url: `video-tool-asset://playback/${project.id}/${asset.id}` } });
      expect(missingPlayback).toEqual({ ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'The requested asset is not available for playback.' } });
      expect(JSON.stringify(playback)).not.toContain(root);
    });
  });

  it('given copied media replaced by a symlink, when playback is requested, then the asset URL is denied', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.webm');
      await writeFile(sourcePath, Buffer.from([1]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Symlink' });
      const assets = new AssetLibraryStore(root, projects);
      const service = new TimelineIpcService({ projects, assets });
      const asset = await assets.import({ projectId: project.id, sourcePath, displayName: 'Take', kind: 'video', mimeType: 'video/webm' });
      const playbackSource = await assets.getPlaybackSource(project.id, asset.id);
      const outsidePath = join(directory, 'outside.webm');
      await writeFile(outsidePath, Buffer.from([2]));
      await rm(playbackSource?.filePath ?? '');
      await symlink(outsidePath, playbackSource?.filePath ?? '');

      // When / Then
      await expect(service.getAssetPlaybackUrl({ projectId: project.id, assetId: asset.id })).resolves.toEqual({
        ok: false,
        error: { code: 'ASSET_NOT_FOUND', message: 'The requested asset is not available for playback.' }
      });
    });
  });
});
