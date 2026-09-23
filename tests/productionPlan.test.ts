import { describe, expect, it } from 'vitest';
import { proposeProductionPlan, approveProductionPlan, productionTextBatch } from '../src/shared/productionPlan';
import { addGenerationCandidate } from '../src/shared/generationReview';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from '../src/shared/aiProjectDomain';
import { approvedWriterShots } from '../src/shared/writerPipeline';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';
const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'A traveler finds a lost letter.', targetDurationSeconds: 8, language: 'Korean', audience: 'General', tone: 'Cinematic' };
const draft: WriterDraft = { title: 'Letter', screenplay: 'A traveler opens the letter at dawn.', characters: [], styleBible: { palette: ['blue'], lighting: 'Dawn', cameraGrammar: 'Wide', texture: 'Film', forbiddenChanges: [] }, scenes: [{ title: 'Station', objective: 'Find the letter', setting: 'Station', timeOfDay: 'Dawn', characterNames: [], continuityNotes: 'Same station', shots: [{ durationSeconds: 8, framing: 'Wide', cameraMotion: 'Static', action: 'A traveler opens the letter', dialogue: '', audioCues: [], negativePrompt: '' }] }] };
const date = '2026-09-24T00:00:00.000Z';
describe('guided production plan', () => {
  it('text batches exclude unapproved plans, unsupported models and already queued shots', () => {
    const proposal = proposeProductionPlan(request, draft, 'test');
    const empty = createEmptyAiProjectDocument();
    expect(productionTextBatch({ ...empty, writerPipeline: proposal }, 'sora-2').ok).toBe(false);
    const document = approveProductionPlan(empty, request, proposal, date, 'queue');
    expect(productionTextBatch(document, 'unsupported').ok).toBe(false);
    expect(productionTextBatch(document, 'sora-2').ok).toBe(true);
    const pending = addGenerationCandidate(document, { id: 'pending', shotId: document.shots[0]!.id, modelId: 'sora-2', providerId: 'openai', capability: 'text_to_video', prompt: 'test', createdAt: date });
    if (!pending.ok) throw new Error(pending.reason);
    expect(productionTextBatch(pending.document, 'sora-2').ok).toBe(false);
  });
  it('persists a whole unapproved proposal without enabling media generation', () => {
    const plan = proposeProductionPlan(request, draft, 'test');
    const document = { ...createEmptyAiProjectDocument(), writerPipeline: plan };
    expect(plan.artifacts).toHaveLength(4);
    expect(plan.artifacts.every(artifact => !artifact.approved)).toBe(true);
    expect(parseAiProjectDocument(document)).not.toBeNull();
    expect(approvedWriterShots(document)).toEqual([]);
  });
  it('explicit package approval prepares shots without creating generation jobs', () => {
    const plan = proposeProductionPlan(request, draft, 'test');
    const original = createEmptyAiProjectDocument();
    const result = approveProductionPlan(original, request, plan, date, 'production-test');
    expect(approvedWriterShots(result)).toHaveLength(1);
    expect(result.generations).toEqual([]);
    expect(original.scripts).toEqual([]);
    expect(() => approveProductionPlan(result, request, result.writerPipeline!, date, 'again')).toThrow('already applied');
  });
  it('rejects changed briefs, incomplete plans and mismatched duration before approval', () => {
    const plan = proposeProductionPlan(request, draft, 'test');
    const document = createEmptyAiProjectDocument();
    expect(() => approveProductionPlan(document, { ...request, sourceText: 'New story' }, plan, date, 'bad')).toThrow('brief changed');
    expect(() => approveProductionPlan(document, request, { ...plan, artifacts: plan.artifacts.slice(0, 3) }, date, 'bad')).toThrow('incomplete');
    const long = { ...request, targetDurationSeconds: 60 };
    expect(() => approveProductionPlan(document, long, proposeProductionPlan(long, draft, 'test'), date, 'bad')).toThrow('Shot total');
  });
});
