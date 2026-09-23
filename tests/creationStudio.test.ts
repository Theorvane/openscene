import { describe, expect, it } from 'vitest';
import { CREATION_STAGES, SCENE_TOOLS, creationStageForTool, creationStudioStatus } from '../src/shared/creationStudio';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { CREATION_TOOLS, isCreationTool } from '../src/shared/workspaceModes';

describe('production studio navigation', () => {
  it('does not claim approval or completion just because assets exist', () => {
    const document = createEmptyAiProjectDocument();
    const before = JSON.stringify(document);
    expect(creationStudioStatus(document, [{ id: 'v', kind: 'video', displayName: 'Take' }, { id: 'a', kind: 'audio', displayName: 'Voice' }])).toEqual({
      story: 'No approved shot plan', scenes: '1 saved videos', sound: '1 audio assets · 0 planned captions'
    });
    expect(JSON.stringify(document)).toBe(before);
    expect(creationStudioStatus(null, []).scenes).toBe('0 saved videos');
  });
  it('keeps every saved tool reachable in three stages without migrating identifiers', () => {
    expect(CREATION_STAGES).toHaveLength(3);
    for (const tool of CREATION_TOOLS) expect(creationStageForTool(tool)).toBeDefined();
    expect([...CREATION_STAGES.map(stage => stage.tool), ...SCENE_TOOLS.map(tool => tool.id)].every(isCreationTool)).toBe(true);
    expect(new Set([...CREATION_STAGES.map(stage => stage.tool), ...SCENE_TOOLS.map(tool => tool.id)])).toEqual(new Set(CREATION_TOOLS));
  });
  it('groups frame preparation and video generation in Scenes', () => {
    expect(creationStageForTool('image').id).toBe('scenes');
    expect(creationStageForTool('video').id).toBe('scenes');
    expect(creationStageForTool('writer').id).toBe('story');
    expect(creationStageForTool('voice').id).toBe('sound');
  });
});
