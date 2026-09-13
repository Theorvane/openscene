import { describe, expect, it } from 'vitest';

import { parsePersistedProject, parsePersistedProjectForRead } from '../src/main/projectSnapshotCodec';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { createInitialTimeline } from '../src/shared/timelineLogic';

const timestamp = '2026-09-02T06:10:00.000Z';
const base = {
  id: 'project-1', name: 'Project', createdAt: timestamp, updatedAt: timestamp, assets: [], timeline: createInitialTimeline()
};

describe('AI project snapshot codec', () => {
  it('requires an AI document in current v4 snapshots', () => {
    expect(parsePersistedProject({ schemaVersion: 4, ...base, ai: createEmptyAiProjectDocument() })).toMatchObject({
      schemaVersion: 4,
      ai: createEmptyAiProjectDocument()
    });
    expect(parsePersistedProject({ schemaVersion: 4, ...base })).toBeNull();
  });

  it('migrates a v3 project into v4 without changing its timeline or assets', () => {
    expect(parsePersistedProjectForRead({ schemaVersion: 3, ...base })).toEqual({
      schemaVersion: 4,
      ...base,
      ai: createEmptyAiProjectDocument()
    });
  });

  it('rejects AI references to assets absent from the same project snapshot', () => {
    const ai = {
      ...createEmptyAiProjectDocument(),
      referenceAssets: [{ id: 'reference-1', assetId: 'missing-asset', role: 'style', label: 'Style' }]
    };
    expect(parsePersistedProject({ schemaVersion: 4, ...base, ai })).toBeNull();
  });

  it('persists a project image held on a video track without inventing an image duration', () => {
    const timeline = createInitialTimeline();
    const videoTrack = timeline.tracks.find((track) => track.kind === 'video')!;
    const still = {
      id: 'asset-still', displayName: 'Continuity frame.jpg', projectRelativePath: 'assets/asset-still/original.jpg',
      kind: 'image' as const, mimeType: 'image/jpeg', byteLength: 512, metadata: { durationMs: 0, width: 1280, height: 720 },
      createdAt: timestamp, updatedAt: timestamp
    };
    const withStill = {
      ...timeline,
      tracks: timeline.tracks.map((track) => track.id === videoTrack.id ? {
        ...track,
        clips: [{
          id: 'clip-still', assetId: still.id, timelineStartMs: 0,
          sourceStartMs: 0, sourceEndMs: 4_000, sourceDurationMs: 4_000,
          effects: { opacity: 1, scale: 1, positionX: 0, positionY: 0, rotation: 0, volume: 1 }, keyframes: []
        }]
      } : track)
    };
    expect(parsePersistedProject({
      schemaVersion: 4, ...base, assets: [still], timeline: withStill, ai: createEmptyAiProjectDocument()
    }))?.toMatchObject({ assets: [{ id: still.id, kind: 'image' }] });
  });

  it('accepts one path-free result origin and rejects a duplicate or malformed origin', () => {
    const asset = {
      id: 'asset-1', displayName: 'Generated image', projectRelativePath: 'assets/asset-1/original.png',
      kind: 'image' as const, mimeType: 'image/png', byteLength: 8, metadata: null,
      resultOrigin: { kind: 'ai-generation' as const, resultId: 'job-1' },
      createdAt: timestamp, updatedAt: timestamp
    };
    const valid = { schemaVersion: 4, ...base, assets: [asset], ai: createEmptyAiProjectDocument() };

    expect(parsePersistedProject(valid))?.toMatchObject({ assets: [{ resultOrigin: asset.resultOrigin }] });
    expect(parsePersistedProject({
      ...valid,
      assets: [asset, { ...asset, id: 'asset-2', projectRelativePath: 'assets/asset-2/original.png' }]
    })).toBeNull();
    expect(parsePersistedProject({
      ...valid,
      assets: [{ ...asset, resultOrigin: { ...asset.resultOrigin, sourcePath: 'C:/private/result.png' } }]
    })).toBeNull();
  });
});
