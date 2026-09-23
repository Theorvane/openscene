import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProjectType, modeForProjectType, projectTypeForMode } from '../src/shared/projectTypes';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { TimelineIpcService } from '../src/main/timelineIpcService';
import { parsePersistedProject } from '../src/main/projectSnapshotCodec';
import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { mkdir } from 'node:fs/promises';

describe('persisted project types', () => {
  it('uses the selected type only for new folders and validates IPC before opening a dialog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-folder-types-'));
    try {
      const folder = join(directory, 'chosen'); await mkdir(folder);
      const projects = new ProjectStore(join(directory, 'projects'), new ProjectLocationRegistry(join(directory, 'locations.json')));
      let dialogs = 0;
      const service = new TimelineIpcService({ projects, assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => { dialogs++; return { canceled: false, filePaths: [folder] }; } });
      expect((await service.openProjectFolder({ projectType: 'bad' })).ok).toBe(false);
      expect(dialogs).toBe(0);
      const created = await service.openProjectFolder({ projectType: 'generation' });
      expect(created.ok && !created.value.cancelled && created.value.project.projectType).toBe('generation');
      const reopened = await service.openProjectFolder({ projectType: 'editing' });
      expect(reopened.ok && !reopened.value.cancelled && reopened.value.project.projectType).toBe('generation');
      expect((await projects.list())[0]?.projectType).toBe('generation');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('distinguishes explicit types from legacy and invalid types', () => {
    expect(parseProjectType(undefined)).toBeUndefined();
    expect(parseProjectType('generation')).toBe('generation');
    expect(parseProjectType('editing')).toBe('editing');
    for (const value of [null, '', 'edit', {}, 1]) expect(parseProjectType(value)).toBeNull();
    expect(modeForProjectType('generation', 'edit')).toBe('create');
    expect(modeForProjectType('editing', 'create')).toBe('edit');
    expect(modeForProjectType(undefined, 'create')).toBe('create');
    expect(projectTypeForMode('create')).toBe('generation');
  });

  it('persists types, preserves untyped projects and independently copies source media', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-types-'));
    try {
      const root = join(directory, 'projects');
      const projects = new ProjectStore(root);
      const assets = new AssetLibraryStore(root, projects);
      const service = new TimelineIpcService({ projects, assets });
      const source = await projects.create({ name: 'Drama', projectType: 'generation' });
      expect((await projects.open(source.id))?.projectType).toBe('generation');
      const { projectType: _type, ...legacy } = source;
      expect(parsePersistedProject(legacy)).toEqual(legacy);
      expect(parsePersistedProject({ ...source, projectType: 'unknown' })).toBeNull();
      const input = join(directory, 'clip.mp4');
      await writeFile(input, new Uint8Array([1, 2, 3]));
      await assets.import({ projectId: source.id, sourcePath: input, displayName: 'Shot', kind: 'video', mimeType: 'video/mp4' });
      const before = await projects.open(source.id);
      const copied = await service.createEditingCopy({ projectId: source.id });
      expect(copied.ok).toBe(true);
      if (!copied.ok) throw new Error(copied.error.message);
      expect(copied.value.projectType).toBe('editing');
      expect(copied.value.id).not.toBe(source.id);
      expect(copied.value.assets).toHaveLength(1);
      expect(copied.value.timeline.tracks.every(track => track.clips.length === 0)).toBe(true);
      expect(await projects.open(source.id)).toEqual(before);
      expect(await projects.open(copied.value.id)).toEqual(copied.value);
      const output = await assets.getPlaybackSource(copied.value.id, copied.value.assets[0]!.id);
      expect(output).not.toBeNull();
      await projects.delete(source.id);
      expect([...await readFile(output!.filePath)]).toEqual([1, 2, 3]);
      expect((await service.createEditingCopy({ projectId: copied.value.id })).ok).toBe(false);
      expect((await service.createEditingCopy({ projectId: '../escape' })).ok).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects missing source media without creating a partial destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-missing-'));
    try {
      const projects = new ProjectStore(join(directory, 'projects'));
      const assets = new AssetLibraryStore(join(directory, 'projects'), projects);
      const source = await projects.create({ name: 'Missing', projectType: 'generation' });
      const input = join(directory, 'clip.mp4');
      await writeFile(input, new Uint8Array([1]));
      const asset = await assets.import({ projectId: source.id, sourcePath: input, displayName: 'Shot', kind: 'video', mimeType: 'video/mp4' });
      const playback = await assets.getPlaybackSource(source.id, asset.id);
      await rm(playback!.filePath);
      const service = new TimelineIpcService({ projects, assets });
      expect((await service.createEditingCopy({ projectId: source.id })).ok).toBe(false);
      expect(await projects.list()).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
