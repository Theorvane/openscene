import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from '../src/shared/aiProjectDomain';
import { approveProductionPlan, proposeProductionPlan } from '../src/shared/productionPlan';
import { approveProductionScene, assembleApprovedProductionCut, productionSceneRows, productionShotRows } from '../src/shared/productionWorkflow';
import { approvedWriterShots } from '../src/shared/writerPipeline';
import { approveNextSequentialScene, buildNextSequentialSceneRequest, canPlanNextSequentialScene, discardNextSequentialScene, proposeNextSequentialScene } from '../src/shared/sequentialProduction';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const at = '2026-09-25T00:00:00.000Z';
const request: WriterRequest = {
  mode: 'idea_to_script', productionScope: 'scene', sourceText: 'A traveler finds a letter.',
  language: 'Korean', audience: 'General', tone: 'Cinematic',
  targetDurationSeconds: 5, shotDurationSeconds: 5
};
const first: WriterDraft = {
  title: 'Letter', screenplay: 'Ari finds a letter at dawn.',
  characters: [{ name: 'Ari', invariantDescription: 'Red coat' }],
  styleBible: { palette: ['blue'], lighting: 'Dawn', cameraGrammar: 'Wide', texture: 'Film', forbiddenChanges: [] },
  scenes: [{ title: 'Station', objective: 'Find the letter', setting: 'Station', timeOfDay: 'Dawn',
    characterNames: ['Ari'], continuityNotes: 'Ari holds the letter.',
    shots: [{ durationSeconds: 5, framing: 'Wide', cameraMotion: 'Static', action: 'Ari picks up the letter.', dialogue: '', audioCues: [], negativePrompt: '' }] }]
};
const second: WriterDraft = {
  ...first, screenplay: 'Ari opens the letter outside.', styleBible: { ...first.styleBible, palette: ['red'] },
  scenes: [{ ...first.scenes[0]!, title: 'Outside', setting: 'Street', continuityNotes: 'Ari keeps the letter.',
    shots: [{ ...first.scenes[0]!.shots[0]!, action: 'Ari opens the letter on the street.' }] }]
};

function finishedFirstScene() {
  const planned = approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, first, 'writer'), at, 'initial');
  const approved = approveProductionScene(planned, planned.scenes[0]!.id, at);
  if (!approved.ok) throw new Error(approved.reason);
  const shot = approved.document.shots[0]!;
  const generation = {
    id: 'first-take', shotId: shot.id, providerId: 'test', modelId: 'test', capability: 'text_to_video' as const,
    status: 'completed' as const, prompt: shot.action, referenceAssetIds: [], outputAssetIds: ['first-video'],
    createdAt: at, updatedAt: at,
    review: { decision: 'approved' as const, continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const,
      settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }, notes: '', reviewedAt: at }
  };
  return { ...approved.document, shots: [{ ...shot, generationIds: [generation.id] }], generations: [generation] };
}

describe('sequential scene production', () => {
  it('plans one five-second-shot scene and requires the current scene to finish before continuing', () => {
    expect(proposeProductionPlan(request, first, 'writer').artifacts).toHaveLength(4);
    expect(() => proposeProductionPlan(request, { ...first, scenes: [...first.scenes, ...first.scenes] }, 'writer')).toThrow('exactly one scene');
    const planned = approveProductionPlan(createEmptyAiProjectDocument(), request, proposeProductionPlan(request, first, 'writer'), at, 'initial');
    expect(canPlanNextSequentialScene(planned)).toBe(false);
    expect(() => buildNextSequentialSceneRequest(planned, 'Ari leaves', 5)).toThrow('Approve every take');
  });

  it('saves a reviewable proposal and appends a scene without changing the approved take or style', () => {
    const original = finishedFirstScene();
    expect(canPlanNextSequentialScene(original)).toBe(true);
    const nextRequest = buildNextSequentialSceneRequest(original, 'Ari opens the letter.', 5);
    expect(nextRequest.sourceText).toContain('Ari holds the letter.');
    const proposed = proposeNextSequentialScene(original, nextRequest, second, 'writer');
    expect(parseAiProjectDocument(proposed)).not.toBeNull();
    expect(JSON.parse(proposed.pendingSequentialScene!.draftJson).styleBible).toEqual(first.styleBible);
    expect(productionShotRows(proposed)).toHaveLength(1);
    expect(discardNextSequentialScene(proposed)).toEqual(original);
    const result = approveNextSequentialScene(proposed, at, 'next');
    expect(result.pendingSequentialScene).toBeUndefined();
    expect(productionSceneRows(result)).toHaveLength(2);
    expect(productionSceneRows(result)[1]).toMatchObject({ order: 1, approved: false, canApprove: true });
    expect(approvedWriterShots(result)).toHaveLength(2);
    expect(result.generations).toEqual(original.generations);
    expect(result.shots[0]).toEqual(original.shots[0]);
    expect(result.styleBible).toEqual(first.styleBible);
    expect(result.writerPipeline?.appliedScriptId).toBe(original.writerPipeline?.appliedScriptId);
    expect(parseAiProjectDocument(result)).not.toBeNull();
  });

  it('appends newly approved scenes after an exact assembled prefix without duplicating old clips', () => {
    const firstPlan = { ok: true as const, totalDurationMs: 5000, shots: [{ shotId: 'first', assetId: 'first-video', durationMs: 5000, sourceDurationMs: 8000 }] };
    const firstCut = assembleApprovedProductionCut({ timeline: createInitialTimeline(), plan: firstPlan, targetTrackId: 'video-track-1', clipIdForShot: id => 'clip-' + id });
    if (!firstCut.ok) throw new Error(firstCut.reason);
    const filmPlan = { ok: true as const, totalDurationMs: 10000, shots: [...firstPlan.shots, { shotId: 'second', assetId: 'second-video', durationMs: 5000, sourceDurationMs: 8000 }] };
    const secondCut = assembleApprovedProductionCut({ timeline: firstCut.timeline, plan: filmPlan, targetTrackId: 'video-track-1', allowExistingPrefix: true, clipIdForShot: id => 'clip-' + id });
    if (!secondCut.ok) throw new Error(secondCut.reason);
    expect(secondCut.timeline.tracks[0]?.clips.map(clip => [clip.assetId, clip.timelineStartMs])).toEqual([['first-video', 0], ['second-video', 5000]]);
    expect(assembleApprovedProductionCut({ timeline: secondCut.timeline, plan: filmPlan, targetTrackId: 'video-track-1', allowExistingPrefix: true, clipIdForShot: id => 'extra-' + id })).toMatchObject({ ok: false, reason: expect.stringContaining('already assembled') });
    const changed = { ...firstCut.timeline, tracks: firstCut.timeline.tracks.map(track => track.id === 'video-track-1' ? { ...track, clips: track.clips.map(clip => ({ ...clip, sourceEndMs: 4000 })) } : track) };
    expect(assembleApprovedProductionCut({ timeline: changed, plan: filmPlan, targetTrackId: 'video-track-1', allowExistingPrefix: true, clipIdForShot: id => 'extra-' + id })).toMatchObject({ ok: false, reason: expect.stringContaining('unedited') });
  });

  it('rejects invalid scene length and stale approval without altering earlier media', () => {
    const original = finishedFirstScene();
    expect(() => buildNextSequentialSceneRequest(original, 'Ari leaves', 7)).toThrow('five-second');
    const nextRequest = buildNextSequentialSceneRequest(original, 'Ari leaves', 5);
    expect(() => proposeNextSequentialScene(original, nextRequest, { ...second, scenes: [...second.scenes, ...second.scenes] }, 'writer')).toThrow('exactly one scene');
    const proposed = proposeNextSequentialScene(original, nextRequest, second, 'writer');
    expect(() => approveNextSequentialScene({ ...proposed, pendingSequentialScene: { ...proposed.pendingSequentialScene!, baseShotCount: 99 } }, at, 'next')).toThrow('film plan changed');
    const { pendingSequentialScene: _pending, ...withoutProposal } = proposed;
    expect(() => approveNextSequentialScene(withoutProposal, at, 'next')).toThrow('next scene');
    expect(original.generations).toHaveLength(1);
  });
});
