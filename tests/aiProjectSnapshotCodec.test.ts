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
});
