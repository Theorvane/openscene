import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { productionDashboard } from '../src/shared/productionDashboard';
import { approveProductionPlan, proposeProductionPlan } from '../src/shared/productionPlan';
import { approveProductionScene, standaloneGenerationBlockReason } from '../src/shared/productionWorkflow';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const at = '2026-09-24T00:00:00.000Z';
const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'A letter', targetDurationSeconds: 10, language: 'Korean', audience: 'General', tone: 'Dramatic' };
const draft: WriterDraft = {
  title: 'The letter', screenplay: 'A letter travels.', characters: [],
  styleBible: { palette: [], lighting: 'Soft', cameraGrammar: 'Wide', texture: 'Film', forbiddenChanges: [] },
  scenes: [
    { title: 'Station', objective: 'Find the letter', setting: 'Station', timeOfDay: 'Day', characterNames: [], continuityNotes: '', shots: [{ durationSeconds: 5, framing: 'Wide', cameraMotion: 'Static', action: 'Find', dialogue: '', audioCues: [], negativePrompt: '' }] },
    { title: 'Home', objective: 'Read the letter', setting: 'Home', timeOfDay: 'Night', characterNames: [], continuityNotes: '', shots: [{ durationSeconds: 5, framing: 'Wide', cameraMotion: 'Static', action: 'Read', dialogue: '', audioCues: [], negativePrompt: '' }] }
  ]
};

describe('production dashboard', () => {
  it('shows only stored approvals and keeps scene timing in screenplay order', () => {
    const document = approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, draft, 'test'), at, 'film');
    const before = productionDashboard(document, []);
    expect(before.title).toBe('The letter');
    expect(before.screenplayApproved).toBe(true);
    expect(standaloneGenerationBlockReason(document)).toContain('scene production board');
    expect(standaloneGenerationBlockReason(document, document.shots[0]!.id)).toBeNull();
    expect(standaloneGenerationBlockReason(createEmptyAiProjectDocument())).toBeNull();
    expect(before.scenes.map(scene => [scene.title, scene.startMs, scene.endMs])).toEqual([['Station', 0, 5000], ['Home', 5000, 10000]]);
    expect(before.stages.find(stage => stage.id === 'scenes')).toMatchObject({ state: 'active', detail: '0/2 scenes approved' });
    expect(before.stages.find(stage => stage.id === 'assembly')?.state).toBe('waiting');
    expect(before.activity).toEqual([]);
    const approval = approveProductionScene(document, document.scenes[0]!.id, at);
    if (!approval.ok) throw new Error(approval.reason);
    const after = productionDashboard(approval.document, []);
    expect(after.stages.find(stage => stage.id === 'scenes')?.detail).toBe('1/2 scenes approved');
    expect(after.activity).toMatchObject([{ detail: 'Scene approved', label: 'Station' }]);
    expect(after.assemblyReady).toBe(false);
  });
});
