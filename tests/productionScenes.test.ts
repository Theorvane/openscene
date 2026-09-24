import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument, parseAiProjectDocument, type AiProjectDocument } from '../src/shared/aiProjectDomain';
import { addGenerationCandidate, decideGenerationCandidate } from '../src/shared/generationReview';
import { approveProductionPlan, proposeProductionPlan, productionTextBatch, productionTextShot } from '../src/shared/productionPlan';
import { approveProductionScene, batchableProductionVideoShotIds, buildApprovedProductionAssemblyPlan, productionSceneRows, productionSceneSummary, productionShotRegenerationBlockReason, productionShotRows } from '../src/shared/productionWorkflow';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const at = '2026-09-24T00:00:00.000Z';
const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'A letter crosses two places.', targetDurationSeconds: 10, language: 'Korean', audience: 'General', tone: 'Dramatic' };
const shot = (action: string) => ({ durationSeconds: 5, framing: 'Wide', cameraMotion: 'Static', action, dialogue: '', audioCues: [], negativePrompt: '' });
const draft: WriterDraft = {
  title: 'Two scenes', screenplay: 'At the station, then at home.', characters: [],
  styleBible: { palette: [], lighting: 'Soft', cameraGrammar: 'Wide', texture: 'Film', forbiddenChanges: [] },
  scenes: [
    { title: 'Station', objective: 'Find the letter', setting: 'Station', timeOfDay: 'Day', characterNames: [], continuityNotes: 'Keep the letter', shots: [shot('Find a letter')] },
    { title: 'Home', objective: 'Read the letter', setting: 'Home', timeOfDay: 'Night', characterNames: [], continuityNotes: 'Same letter', shots: [shot('Read the letter')] }
  ]
};
function plan(): AiProjectDocument {
  return approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, draft, 'test'), at, 'film');
}
function completeFirstTake(document: AiProjectDocument): AiProjectDocument {
  const added = addGenerationCandidate(document, { id: 'take-1', shotId: document.shots[0]!.id, providerId: 'test', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Find a letter', createdAt: at });
  if (!added.ok) throw new Error(added.reason);
  return { ...added.document, generations: added.document.generations.map((entry) => entry.id === 'take-1' ? {
    ...entry, status: 'completed' as const, outputAssetIds: ['video-1'], review: {
      decision: 'approved' as const, notes: '', reviewedAt: at,
      continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }
    }
  } : entry) };
}

describe('scene-by-scene production', () => {
  it('keeps a multi-scene plan ordered and requires explicit approval before any provider candidate', () => {
    const document = plan();
    expect(productionSceneRows(document).map((scene) => [scene.title, scene.durationMs, scene.canApprove])).toEqual([
      ['Station', 5000, true], ['Home', 5000, false]
    ]);
    expect(batchableProductionVideoShotIds(document)).toEqual([]);
    expect(addGenerationCandidate(document, { id: 'blocked', shotId: document.shots[0]!.id, providerId: 'test', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Test', createdAt: at })).toMatchObject({ ok: false, reason: expect.stringContaining('Approve Station') });
    expect(approveProductionScene(document, document.scenes[1]!.id, at)).toMatchObject({ ok: false, reason: expect.stringContaining('preceding scene') });
    const first = approveProductionScene(document, document.scenes[0]!.id, at);
    if (!first.ok) throw new Error(first.reason);
    expect(parseAiProjectDocument(first.document)).not.toBeNull();
    expect(batchableProductionVideoShotIds(first.document)).toEqual([document.shots[0]!.id]);
    expect(batchableProductionVideoShotIds(first.document, document.scenes[1]!.id)).toEqual([]);
    expect(batchableProductionVideoShotIds(first.document, document.scenes[0]!.id)).toEqual([document.shots[0]!.id]);
    expect(productionTextBatch(first.document, 'sora-2', document.scenes[1]!.id).ok).toBe(false);
    expect(productionTextBatch(first.document, 'sora-2', document.scenes[0]!.id)).toMatchObject({ ok: true, shots: [{ id: document.shots[0]!.id }] });
    expect(productionSceneSummary(productionSceneRows(first.document)[0]!, productionShotRows(first.document))).toMatchObject({ stage: 'generate', pendingCount: 1, reviewCount: 0 });
    expect(addGenerationCandidate(first.document, { id: 'blocked-2', shotId: document.shots[1]!.id, providerId: 'test', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Test', createdAt: at }).ok).toBe(false);
    expect(buildApprovedProductionAssemblyPlan(first.document, [])).toMatchObject({ ok: false, reason: expect.stringContaining('every planned scene') });
  });

  it('opens the next scene only after the preceding take is complete and approved', () => {
    const planned = plan();
    const firstApproval = approveProductionScene(planned, planned.scenes[0]!.id, at);
    if (!firstApproval.ok) throw new Error(firstApproval.reason);
    const completed = completeFirstTake(firstApproval.document);
    expect(productionSceneRows(completed).map((scene) => scene.complete)).toEqual([true, false]);
    expect(productionSceneSummary(productionSceneRows(completed)[0]!, productionShotRows(completed)).stage).toBe('complete');
    const secondApproval = approveProductionScene(completed, completed.scenes[1]!.id, at);
    if (!secondApproval.ok) throw new Error(secondApproval.reason);
    expect(batchableProductionVideoShotIds(secondApproval.document)).toEqual([planned.shots[1]!.id]);
    const revoked = { ...secondApproval.document, generations: secondApproval.document.generations.map((entry) => entry.id === 'take-1' ? {
      ...entry, review: { ...entry.review!, decision: 'pending' as const }
    } : entry) };
    expect(batchableProductionVideoShotIds(revoked)).toEqual([]);
    expect(addGenerationCandidate(revoked, { id: 'blocked-later', shotId: planned.shots[1]!.id, providerId: 'test', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Test', createdAt: at }).ok).toBe(false);
    const second = addGenerationCandidate(secondApproval.document, { id: 'take-2', shotId: planned.shots[1]!.id, providerId: 'test', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Read the letter', createdAt: at });
    if (!second.ok) throw new Error(second.reason);
    const finished = { ...second.document, generations: second.document.generations.map((entry) => entry.id === 'take-2' ? {
      ...entry, status: 'completed' as const, outputAssetIds: ['video-2'], review: {
        decision: 'approved' as const, notes: '', reviewedAt: at,
        continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }
      }
    } : entry) };
    expect(buildApprovedProductionAssemblyPlan(finished, [
      { id: 'video-1', kind: 'video', durationMs: 8000 }, { id: 'video-2', kind: 'video', durationMs: 8000 }
    ])).toMatchObject({ ok: true, totalDurationMs: 10000, shots: [{ durationMs: 5000, sourceDurationMs: 8000, shotId: planned.shots[0]!.id }, { durationMs: 5000, sourceDurationMs: 8000, shotId: planned.shots[1]!.id }] });
  });

  it('shows the exact planned prompt and generates one selected shot without discarding its approved take', () => {
    const original = plan();
    const shotId = original.shots[0]!.id;
    expect(productionShotRows(original)[0]?.prompt).toContain('Find a letter');
    expect(productionTextShot(original, 'sora-2', shotId)).toMatchObject({ ok: false, reason: expect.stringContaining('Approve Station') });
    const approval = approveProductionScene(original, original.scenes[0]!.id, at);
    if (!approval.ok) throw new Error(approval.reason);
    const single = productionTextShot(approval.document, 'sora-2', shotId);
    expect(single).toMatchObject({ ok: true, shot: { id: shotId, durationSeconds: 5, sourceDurationSeconds: 8 } });
    const queued = addGenerationCandidate(approval.document, { id: 'queued', shotId, providerId: 'openai', modelId: 'sora-2', capability: 'text_to_video', prompt: 'First try', createdAt: at });
    if (!queued.ok) throw new Error(queued.reason);
    expect(productionShotRegenerationBlockReason(queued.document, shotId)).toContain('current shot generation');
    expect(productionTextShot(queued.document, 'sora-2', shotId).ok).toBe(false);
    expect(addGenerationCandidate(queued.document, { id: 'duplicate', shotId, providerId: 'openai', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Duplicate', createdAt: at }).ok).toBe(false);
    const approved = completeFirstTake(approval.document);
    const replacement = addGenerationCandidate(approved, { id: 'replacement', shotId, providerId: 'openai', modelId: 'sora-2', capability: 'text_to_video', prompt: 'Refined shot', createdAt: at });
    if (!replacement.ok) throw new Error(replacement.reason);
    expect(productionShotRows(replacement.document)[0]).toMatchObject({ candidateCount: 2, state: 'approved', approvedGeneration: { id: 'take-1' } });
    const completed = { ...replacement.document, generations: replacement.document.generations.map(item => item.id === 'replacement' ? {
      ...item, status: 'completed' as const, outputAssetIds: ['video-new'], review: {
        decision: 'pending' as const, notes: '',
        continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }
      }
    } : item) };
    const decided = decideGenerationCandidate(completed, 'replacement', 'approved', '', at);
    if (!decided.ok) throw new Error(decided.reason);
    expect(productionShotRows(decided.document)[0]?.approvedGeneration?.id).toBe('replacement');
    expect(decided.document.generations.find(item => item.id === 'take-1')?.review?.decision).toBe('rejected');
    expect(productionTextShot(decided.document, 'sora-2', shotId).ok).toBe(true);
  });

  it('loads older scene documents without implicitly approving them', () => {
    const old = plan();
    const parsed = parseAiProjectDocument(old);
    expect(parsed?.scenes.every((scene) => scene.productionApprovedAt === undefined)).toBe(true);
    expect(parseAiProjectDocument({ ...old, scenes: old.scenes.map((scene) => ({ ...scene, productionApprovedAt: 'bad' })) })).toBeNull();
  });
});
