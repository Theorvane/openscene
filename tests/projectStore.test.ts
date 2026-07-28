import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { ProjectStore } from '../src/main/projectStore';
import { createInitialTimeline, updateClipEffects } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-project-store-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('project store', () => {
  it('given a strict v1 project, when opened and saved, then timeline metadata is defaulted and persisted as v3', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const projectId = 'legacy-project';
      const timestamp = '2026-07-20T10:00:00.000Z';
      const legacySnapshot = {
        schemaVersion: 1,
        id: projectId,
        name: 'Legacy project',
        createdAt: timestamp,
        updatedAt: timestamp,
        assets: [
          {
            id: 'asset-1',
            displayName: 'Legacy take',
            projectRelativePath: 'assets/asset-1/original.webm',
            kind: 'video',
            mimeType: 'video/webm',
            byteLength: 1,
            metadata: { durationMs: 1_000 },
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        timeline: {
          schemaVersion: 1,
          tracks: [
            {
              id: 'video-track-1',
              name: 'Video 1',
              kind: 'video',
              clips: [
                {
                  id: 'clip-1',
                  assetId: 'asset-1',
                  timelineStartMs: 0,
                  sourceStartMs: 0,
                  sourceEndMs: 1_000,
                  sourceDurationMs: 1_000
                }
              ]
            }
          ]
        }
      };
      await mkdir(join(root, projectId));
      await writeFile(join(root, projectId, 'project.json'), JSON.stringify(legacySnapshot), 'utf8');
      const store = new ProjectStore(root);

      // When
      const migrated = await store.open(projectId);
      if (migrated === null) {
        throw new Error('Expected the v1 project to migrate.');
      }
      const updatedTimeline = updateClipEffects(migrated.timeline, { clipId: 'clip-1', effects: { opacity: 0.4 } });
      if (updatedTimeline === null) {
        throw new Error('Expected migrated clip effects to update.');
      }
      const saved = await store.saveTimeline(projectId, updatedTimeline, new Date('2026-07-20T10:01:00.000Z'));
      const persisted = JSON.parse(await readFile(join(root, projectId, 'project.json'), 'utf8'));

      // Then
      expect(migrated).toMatchObject({
        schemaVersion: 3,
        timeline: {
          schemaVersion: 3,
          transitions: [],
          tracks: [{ clips: [{ effects: DEFAULT_CLIP_EFFECTS, keyframes: [] }] }]
        }
      });
      expect(saved.timeline.tracks[0]?.clips[0]?.effects).toEqual({ ...DEFAULT_CLIP_EFFECTS, opacity: 0.4 });
      expect(persisted).toEqual(saved);
    });
  });

  it('given a strict v2 project, when opened, then v3 keyframe, transition, and audio mix defaults are applied', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const projectId = 'v2-project';
      const timestamp = '2026-07-20T10:00:00.000Z';
      const v2Snapshot = {
        schemaVersion: 2,
        id: projectId,
        name: 'Version two',
        createdAt: timestamp,
        updatedAt: timestamp,
        assets: [],
        timeline: {
          schemaVersion: 2,
          tracks: [
            { id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [] },
            { id: 'audio-track-1', name: 'Audio 1', kind: 'audio', clips: [] }
          ]
        }
      };
      await mkdir(join(root, projectId));
      await writeFile(join(root, projectId, 'project.json'), JSON.stringify(v2Snapshot), 'utf8');

      // When
      const migrated = await new ProjectStore(root).open(projectId);

      // Then
      expect(migrated).toMatchObject({
        schemaVersion: 3,
        timeline: {
          schemaVersion: 3,
          transitions: [],
          tracks: [
            { kind: 'video' },
            { kind: 'audio', mix: DEFAULT_AUDIO_TRACK_MIX }
          ]
        }
      });
    });
  });

  it('given a supplied root, when a project is created and reopened, then a durable initial snapshot and summary are returned', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const createdAt = new Date('2026-07-20T10:00:00.000Z');
      const store = new ProjectStore(root);

      // When
      const created = await store.create({ name: 'Product demo' }, createdAt);
      const reopened = await new ProjectStore(root).open(created.id);
      const summaries = await new ProjectStore(root).list();
      const persisted = JSON.parse(await readFile(join(root, created.id, 'project.json'), 'utf8'));

      // Then
      expect(created.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      expect(created).toEqual({
        schemaVersion: 3,
        id: created.id,
        name: 'Product demo',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        assets: [],
        timeline: createInitialTimeline()
      });
      expect(reopened).toEqual(created);
      expect(summaries).toEqual([
        {
          id: created.id,
          name: created.name,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          storage: 'internal'
        }
      ]);
      expect(persisted).toEqual(created);
    });
  });

  it('given a project, when its timeline is saved, then updatedAt advances and only an atomic project file remains', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const store = new ProjectStore(root);
      const created = await store.create({ name: 'Timeline edit' }, new Date('2026-07-20T10:00:00.000Z'));
      const timeline = {
        ...createInitialTimeline(),
        tracks: [
          ...createInitialTimeline().tracks,
          { id: 'audio-track-2', name: 'Audio 2', kind: 'audio' as const, clips: [], mix: DEFAULT_AUDIO_TRACK_MIX }
        ]
      };

      // When
      const saved = await store.saveTimeline(created.id, timeline, new Date('2026-07-20T10:01:00.000Z'));
      const projectEntries = await readdir(join(root, created.id));

      // Then
      expect(saved.timeline).toEqual(timeline);
      expect(saved.updatedAt).toBe('2026-07-20T10:01:00.000Z');
      expect(projectEntries).toEqual(['project.json']);
      await expect(new ProjectStore(root).open(created.id)).resolves.toEqual(saved);
    });
  });

  it('given a timeline with an unknown asset, when save is attempted, then the previous snapshot remains intact', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const store = new ProjectStore(root);
      const created = await store.create({ name: 'Relation validation' }, new Date('2026-07-20T10:00:00.000Z'));
      const invalidTimeline = {
        schemaVersion: 3 as const,
        tracks: [
          {
            id: 'video-track-1',
            name: 'Video 1',
            kind: 'video' as const,
            clips: [
              {
                id: 'clip-1',
                assetId: 'missing-asset',
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1_000,
                sourceDurationMs: 1_000,
                effects: DEFAULT_CLIP_EFFECTS,
                keyframes: []
              }
            ]
          }
        ],
        transitions: []
      };

      // When / Then
      await expect(store.saveTimeline(created.id, invalidTimeline)).rejects.toThrow(
        'Timeline clip clip-1 references an unavailable video asset.'
      );
      await expect(store.open(created.id)).resolves.toEqual(created);
      expect(await readdir(join(root, created.id))).toEqual(['project.json']);
    });
  });

  it('given unsafe ids, paths, and an unknown directory, when opened or deleted, then no path outside a known project is touched', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const store = new ProjectStore(root);
      const created = await store.create({ name: 'Safe delete' });
      const outsideFile = join(root, 'outside.txt');
      const unknownDirectory = join(root, 'unknown-project');
      await writeFile(outsideFile, 'keep', 'utf8');
      await mkdir(unknownDirectory);
      await writeFile(join(unknownDirectory, 'keep.txt'), 'keep', 'utf8');

      // When / Then
      await expect(store.open('../outside')).rejects.toThrow('Invalid project id.');
      await expect(store.delete('../outside')).rejects.toThrow('Invalid project id.');
      await expect(store.delete('unknown-project')).resolves.toBe(false);
      await expect(store.delete(created.id)).resolves.toBe(true);
      await expect(stat(join(root, created.id))).rejects.toThrow();
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
      await expect(readFile(join(unknownDirectory, 'keep.txt'), 'utf8')).resolves.toBe('keep');
    });
  });

  it('given a persisted asset path that escapes the project, when reopened, then the snapshot is rejected', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const store = new ProjectStore(root);
      const created = await store.create({ name: 'Tampered project' });
      const projectFile = join(root, created.id, 'project.json');
      const tampered = {
        ...created,
        assets: [
          {
            id: 'asset-1',
            displayName: 'Escape',
            projectRelativePath: '../outside.webm',
            kind: 'video',
            mimeType: 'video/webm',
            byteLength: 1,
            metadata: null,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt
          }
        ]
      };
      await writeFile(projectFile, JSON.stringify(tampered), 'utf8');

      // When / Then
      await expect(new ProjectStore(root).open(created.id)).resolves.toBeNull();
      await expect(new ProjectStore(root).list()).resolves.toEqual([]);
    });
  });

  it('given a persisted asset path targeting the project manifest, when reopened, then the snapshot is rejected', async () => {
    await withTempDirectory(async (root) => {
      // Given
      const store = new ProjectStore(root);
      const created = await store.create({ name: 'Manifest alias' });
      await writeFile(
        join(root, created.id, 'project.json'),
        JSON.stringify({
          ...created,
          assets: [
            {
              id: 'asset-1',
              displayName: 'Manifest',
              projectRelativePath: 'project.json',
              kind: 'video',
              mimeType: 'video/webm',
              byteLength: 1,
              metadata: null,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt
            }
          ]
        }),
        'utf8'
      );

      // When / Then
      await expect(new ProjectStore(root).open(created.id)).resolves.toBeNull();
    });
  });
});

describe('folder-backed project store', () => {
  function folderStore(directory: string): ProjectStore {
    return new ProjectStore(join(directory, 'projects'), new ProjectLocationRegistry(join(directory, 'project-locations.json')));
  }

  it('given a picked parent folder, when a project is created, then it lives in a named real folder and lists as external', async () => {
    await withTempDirectory(async (directory) => {
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const store = folderStore(directory);

      const created = await store.createInFolder({ name: 'My Cutdown', parentDirectory: workspace });

      await expect(readFile(join(workspace, 'My Cutdown', 'project.json'), 'utf8')).resolves.toContain(created.id);
      await expect(store.open(created.id)).resolves.toEqual(created);
      const summaries = await store.list();
      expect(summaries).toEqual([
        {
          id: created.id,
          name: 'My Cutdown',
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          storage: 'external',
          folderName: 'My Cutdown'
        }
      ]);
    });
  });

  it('given a name collision in the parent folder, when created, then a numbered sibling folder is used', async () => {
    await withTempDirectory(async (directory) => {
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const store = folderStore(directory);

      await store.createInFolder({ name: 'Cut', parentDirectory: workspace });
      const second = await store.createInFolder({ name: 'Cut', parentDirectory: workspace });

      await expect(readFile(join(workspace, 'Cut 2', 'project.json'), 'utf8')).resolves.toContain(second.id);
    });
  });

  it('given an external project, when deleted, then it is only removed from the list and the real folder survives', async () => {
    await withTempDirectory(async (directory) => {
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const store = folderStore(directory);
      const created = await store.createInFolder({ name: 'Keep Files', parentDirectory: workspace });

      await expect(store.delete(created.id)).resolves.toBe(true);

      expect(await store.list()).toEqual([]);
      await expect(readFile(join(workspace, 'Keep Files', 'project.json'), 'utf8')).resolves.toContain(created.id);
    });
  });

  it('given a folder that contains a project, when opened from folder, then the location is re-registered and edits persist there', async () => {
    await withTempDirectory(async (directory) => {
      const workspace = join(directory, 'workspace');
      await mkdir(workspace);
      const store = folderStore(directory);
      const created = await store.createInFolder({ name: 'Reopen', parentDirectory: workspace });
      await store.delete(created.id);

      const reopened = await store.openFromFolder(join(workspace, 'Reopen'));

      expect(reopened?.id).toBe(created.id);
      const saved = await store.saveTimeline(created.id, createInitialTimeline());
      expect(saved.id).toBe(created.id);
      await expect(readFile(join(workspace, 'Reopen', 'project.json'), 'utf8')).resolves.toContain(saved.updatedAt);
    });
  });

  it('given a folder without a project file, when opened from folder, then null is returned and nothing is registered', async () => {
    await withTempDirectory(async (directory) => {
      const emptyFolder = join(directory, 'empty');
      await mkdir(emptyFolder);
      const store = folderStore(directory);

      await expect(store.openFromFolder(emptyFolder)).resolves.toBeNull();
      expect(await store.list()).toEqual([]);
    });
  });
});
