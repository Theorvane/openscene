import { describe, expect, it } from 'vitest';

import { addEditAgentContextAsset, type EditAgentContextAsset } from '../src/shared/editAgentContext';

const VIDEO_ASSET: EditAgentContextAsset = {
  projectId: 'project-1',
  assetId: 'asset-video-1',
  label: 'Generated city shot',
  mediaKind: 'video',
  durationMs: 5000
};

describe('Edit Agent asset context', () => {
  it('deduplicates an explicitly attached project asset by project and asset id', () => {
    expect(addEditAgentContextAsset([VIDEO_ASSET], VIDEO_ASSET)).toEqual([VIDEO_ASSET]);
  });

  it('does not expose output paths, API keys, or arbitrary filesystem references', () => {
    expect(Object.keys(VIDEO_ASSET)).toEqual(['projectId', 'assetId', 'label', 'mediaKind', 'durationMs']);
  });

  it('rejects blank project or asset identifiers', () => {
    expect(() => addEditAgentContextAsset([], { ...VIDEO_ASSET, assetId: ' ' })).toThrow('assetId');
    expect(() => addEditAgentContextAsset([], { ...VIDEO_ASSET, projectId: '' })).toThrow('projectId');
  });
});
