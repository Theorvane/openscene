import { describe, expect, it } from 'vitest';
import { proposeProductionPlan, approveProductionPlan, productionTextBatch, approveProductionCheckpoint, nextProductionCheckpoint } from '../src/shared/productionPlan';
import { WRITER_STAGES } from '../src/shared/writerStages';
import { addGenerationCandidate } from '../src/shared/generationReview';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from '../src/shared/aiProjectDomain';
import { approvedWriterShots } from '../src/shared/writerPipeline';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';
import { productionCompanions } from '../src/shared/productionCompanions';
import { createNarrationPlan } from '../src/shared/subtitleWorkflow';
const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'A traveler finds a lost letter.', targetDurationSeconds: 8, language: 'Korean', audience: 'General', tone: 'Cinematic' };
const draft: WriterDraft = { title: 'Letter', screenplay: 'A traveler opens the letter at dawn.', characters: [], styleBible: { palette: ['blue'], lighting: 'Dawn', cameraGrammar: 'Wide', texture: 'Film', forbiddenChanges: [] }, scenes: [{ title: 'Station', objective: 'Find the letter', setting: 'Station', timeOfDay: 'Dawn', characterNames: [], continuityNotes: 'Same station', shots: [{ durationSeconds: 8, framing: 'Wide', cameraMotion: 'Static', action: 'A traveler opens the letter', dialogue: '', audioCues: [], negativePrompt: '' }] }] };
const date = '2026-09-24T00:00:00.000Z';
describe('guided production plan', () => {
  it('requires ordered saved checkpoints and prepares shots only after final approval', () => {
    let document = { ...createEmptyAiProjectDocument(), writerPipeline: proposeProductionPlan(request, draft, 'test') };
    const before = JSON.stringify(document);
    expect(() => approveProductionCheckpoint(document, request, document.writerPipeline, 'prompts', date, 'skip')).toThrow('current checkpoint');
    expect(JSON.stringify(document)).toBe(before);
    for (const stage of WRITER_STAGES) {
      expect(nextProductionCheckpoint(document.writerPipeline)).toBe(stage);
      const saved = approveProductionCheckpoint(document, request, document.writerPipeline, stage, date, 'checkpoint');
      expect(parseAiProjectDocument(saved)).not.toBeNull();
      document = { ...saved, writerPipeline: saved.writerPipeline! };
      expect(document.writerPipeline.artifacts.find(item => item.stage === stage)?.approved).toBe(true);
      expect(approvedWriterShots(document)).toHaveLength(stage === 'prompts' ? 1 : 0);
      expect(document.generations).toHaveLength(0);
    }
    expect(nextProductionCheckpoint(document.writerPipeline)).toBeNull();
    expect(() => approveProductionCheckpoint(document, request, document.writerPipeline, 'prompts', date, 'again')).toThrow('already applied');
  });
  it('rejects stale briefs and missing checkpoint artifacts without changing the project', () => {
    const document = createEmptyAiProjectDocument();
    const proposal = proposeProductionPlan(request, draft, 'test');
    expect(nextProductionCheckpoint(undefined)).toBeNull();
    expect(() => approveProductionCheckpoint(document, { ...request, sourceText: 'Changed' }, proposal, 'concept', date, 'stale')).toThrow('brief changed');
    expect(() => approveProductionCheckpoint(document, request, { ...proposal, artifacts: [] }, 'concept', date, 'missing')).toThrow('missing');
    expect(document.scripts).toEqual([]);
  });
  it('derives frame availability from saved image evidence, not a dangling reference', () => {
    const approved = approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, draft, 'test'), date, 'frames');
    const document = { ...approved, shots: approved.shots.map(shot => ({ ...shot, referenceAssetIds: ['frame'] })), referenceAssets: [{ id: 'frame', assetId: 'image', role: 'start_frame' as const, label: 'First frame' }] };
    expect(productionCompanions(document, []).frames).toBe(0);
    expect(productionCompanions(document, [{ id: 'image', kind: 'video', displayName: 'Wrong kind' }]).frames).toBe(0);
    expect(productionCompanions(document, [{ id: 'image', kind: 'image', displayName: 'Frame' }]).frames).toBe(1);
  });
  it('distinguishes approved dialogue, drafts, approval and outdated narration without implying synthesis', () => {
    const spoken = { ...draft, scenes: draft.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => ({ ...shot, dialogue: 'Narrator: The letter arrived.' })) })) };
    const approved = approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, spoken, 'test'), date, 'voice');
    expect(productionCompanions(approved, []).voiceState).toBe('available');
    const narrationPlan = createNarrationPlan({ ai: approved, durationMs: 8000, voiceModelId: 'test', voiceId: 'test' });
    const document = { ...approved, narrationPlan };
    expect(productionCompanions(document, []).voiceState).toBe('draft');
    const ready = { ...document, narrationPlan: { ...narrationPlan, status: 'approved' as const } };
    const before = JSON.stringify(ready);
    const status = productionCompanions(ready, [{ id: 'audio', kind: 'audio', displayName: 'Unplaced voice' }]);
    expect(status.voiceState).toBe('approved');
    expect(status.audioAssets).toBe(1);
    expect(status.placedAudioAssets).toBe(0);
    expect(JSON.stringify(ready)).toBe(before);
    const { writerPipeline: _pipeline, ...withoutPlan } = ready;
    expect(productionCompanions(withoutPlan, []).voiceState).toBe('outdated');
    expect(productionCompanions(createEmptyAiProjectDocument(), []).voiceState).toBe('empty');
  });
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
