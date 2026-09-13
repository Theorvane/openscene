import { describe, expect, it } from 'vitest';

import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { applyWriterPipeline, artifactFromWriterDraft, saveWriterArtifact, startWriterPipeline } from '../src/shared/writerPipeline';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';
import type { WriterStageArtifact } from '../src/shared/writerStages';
import {
  activeStyleReference,
  addCharacterReference,
  assembleApprovedProductionCut,
  attachGeneratedProductionImage,
  assignStoryboardReference,
  assignStyleReference,
  buildCharacterReferenceImageBrief,
  buildApprovedProductionAssemblyPlan,
  buildStoryboardImageBrief,
  batchableProductionVideoShotIds,
  clearStoryboardReference,
  clearStyleReference,
  missingProductionImageTargets,
  planProductionVideoReferences,
  productionShotRows,
  removeCharacterReference
} from '../src/shared/productionWorkflow';
import { createInitialTimeline } from '../src/shared/timelineLogic';

const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'Story', language: 'English', audience: 'All', tone: 'Cinematic', targetDurationSeconds: 8, videoStyle: 'cinematic-narrative', emotionalGoal: 'entertain' };
const draft: WriterDraft = {
  title: 'Film', screenplay: 'Full screenplay',
  characters: [{ name: 'Ari', invariantDescription: 'Red coat' }],
  styleBible: { palette: ['blue'], lighting: 'soft', cameraGrammar: 'locked', texture: 'film', forbiddenChanges: [] },
  scenes: [{ title: 'Scene', objective: 'Act', setting: 'Room', timeOfDay: 'Day', characterNames: ['Ari'], continuityNotes: 'Same coat', shots: [
    { durationSeconds: 4, framing: 'Wide', cameraMotion: 'Still', action: 'Ari enters', dialogue: '', audioCues: [], negativePrompt: '' },
    { durationSeconds: 4, framing: 'Close', cameraMotion: 'Push', action: 'Ari smiles', dialogue: '', audioCues: [], negativePrompt: '' }
  ] }]
};
const artifact = (stage: 'concept' | 'screenplay' | 'breakdown', content = stage): WriterStageArtifact => ({ stage, title: 'Film', content, modelId: 'test', approved: false });

function project(writerRequest: WriterRequest = request) {
  let state = startWriterPipeline(writerRequest);
  for (const stage of ['concept', 'screenplay', 'breakdown'] as const) state = saveWriterArtifact(state, artifact(stage), true);
  state = saveWriterArtifact(state, artifactFromWriterDraft('prompts', draft, 'test'), true);
  const applied = applyWriterPipeline(createEmptyAiProjectDocument(), state, '2026-09-07T00:00:00.000Z', 'production');
  if (!applied.ok) throw new Error(applied.message);
  return applied.document;
}

function approvedProject() {
  const base = project();
  const generations = base.shots.map((shot, index) => ({
    id: `generation-${index}`, shotId: shot.id, providerId: 'gemini_veo', modelId: 'veo', capability: 'image_to_video' as const,
    status: 'completed' as const, prompt: shot.action, referenceAssetIds: [], outputAssetIds: [`video-${index}`],
    createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:01:00.000Z',
    review: { decision: 'approved' as const, continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }, notes: '', reviewedAt: '2026-09-07T00:02:00.000Z' }
  }));
  return { ...base, shots: base.shots.map((shot, index) => ({ ...shot, generationIds: [generations[index]!.id] })), generations };
}

describe('production storyboard workflow', () => {
  it('compiles editable Character and Storyboard image briefs from approved Writer data', () => {
    const base = project();
    const [character] = base.characters;
    const [shot] = base.shots;
    if (!character || !shot) throw new Error('fixture missing');

    const characterBrief = buildCharacterReferenceImageBrief(base, character.id);
    expect(characterBrief).toMatchObject({
      ok: true,
      brief: {
        target: { kind: 'character_reference', characterId: character.id },
        targetLabel: 'Character reference for Ari',
        aspectRatio: '3:4',
        stylePreset: 'Cinematic narrative',
        styleSource: 'writer'
      }
    });
    if (characterBrief.ok) {
      expect(characterBrief.brief.prompt).toContain('Red coat');
      expect(characterBrief.brief.prompt).toContain('Palette: blue');
      expect(characterBrief.brief.negativePrompt).toContain('watermark');
    }

    const withCharacterReference = addCharacterReference(base, {
      characterId: character.id,
      assetId: 'asset-thok',
      referenceId: 'reference-thok',
      label: 'thok.jpeg'
    });
    if (!withCharacterReference.ok) throw new Error(withCharacterReference.reason);

    const withStyleReference = assignStyleReference(withCharacterReference.document, {
      assetId: 'asset-world-style', referenceId: 'reference-world-style', label: 'world style.jpeg'
    });
    if (!withStyleReference.ok) throw new Error(withStyleReference.reason);

    const storyboardBrief = buildStoryboardImageBrief(withStyleReference.document, shot.id, '9:16');
    expect(storyboardBrief).toMatchObject({
      ok: true,
      brief: {
        target: { kind: 'storyboard', shotId: shot.id },
        aspectRatio: '9:16'
      }
    });
    if (storyboardBrief.ok) {
      expect(storyboardBrief.brief.prompt).toContain('Ari: Red coat');
      expect(storyboardBrief.brief.prompt).toContain('Visible action at this first frame: Ari enters');
      expect(storyboardBrief.brief.prompt).toContain('Continuity: Same coat');
      expect(storyboardBrief.brief.referenceAssetIds).toEqual(['asset-world-style', 'asset-thok']);
      expect(storyboardBrief.brief.prompt).toContain('first attached image as the authoritative world/style reference');
    }
  });

  it('persists one replaceable project-wide world/style reference', () => {
    const base = project();
    const assigned = assignStyleReference(base, {
      assetId: 'style-one', referenceId: 'style-reference-one', label: 'World one'
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(activeStyleReference(assigned.document)?.assetId).toBe('style-one');
    const replaced = assignStyleReference(assigned.document, {
      assetId: 'style-two', referenceId: 'style-reference-two', label: 'World two'
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.document.referenceAssets.filter((entry) => entry.role === 'style')).toHaveLength(1);
    expect(activeStyleReference(replaced.document)?.assetId).toBe('style-two');
    const cleared = clearStyleReference(replaced.document);
    expect(cleared.ok && activeStyleReference(cleared.document)).toBeUndefined();
  });

  it('allocates limited storyboard slots across characters instead of letting the first character consume them', () => {
    const base = project();
    const firstCharacter = base.characters[0]!;
    const firstScene = base.scenes[0]!;
    const firstShot = base.shots[0]!;
    const document = {
      ...base,
      characters: [
        { ...firstCharacter, referenceAssetIds: ['ref-ari-a', 'ref-ari-b'] },
        { id: 'character-bex', name: 'Bex', invariantDescription: 'Blue scarf', referenceAssetIds: ['ref-bex-a', 'ref-bex-b'] }
      ],
      scenes: base.scenes.map((scene) => scene.id === firstScene.id
        ? { ...scene, characterIds: [firstCharacter.id, 'character-bex'] }
        : scene),
      referenceAssets: [
        { id: 'ref-style', assetId: 'asset-style', role: 'style' as const, label: 'World style' },
        { id: 'ref-ari-a', assetId: 'asset-ari-a', role: 'character' as const, label: 'Ari front' },
        { id: 'ref-ari-b', assetId: 'asset-ari-b', role: 'character' as const, label: 'Ari side' },
        { id: 'ref-bex-a', assetId: 'asset-bex-a', role: 'character' as const, label: 'Bex front' },
        { id: 'ref-bex-b', assetId: 'asset-bex-b', role: 'character' as const, label: 'Bex side' }
      ]
    };
    const brief = buildStoryboardImageBrief(document, firstShot.id);
    expect(brief.ok && brief.brief.referenceAssetIds).toEqual(['asset-style', 'asset-ari-a', 'asset-bex-a']);
  });

  it('does not silently drop selected style or character references when planning production video', () => {
    const base = project();
    const character = base.characters[0]!;
    const shot = base.shots[0]!;
    const withCharacter = addCharacterReference(base, {
      characterId: character.id, assetId: 'asset-character', referenceId: 'ref-character', label: 'Ari'
    });
    if (!withCharacter.ok) throw new Error(withCharacter.reason);
    const withStyle = assignStyleReference(withCharacter.document, {
      assetId: 'asset-style', referenceId: 'ref-style', label: 'World style'
    });
    if (!withStyle.ok) throw new Error(withStyle.reason);
    const controls = { characterConsistency: true, styleConsistency: true, sceneConsistency: true, motionContinuity: false };
    expect(planProductionVideoReferences(withStyle.document, shot.id, {
      controls, supportsImageToVideo: true, supportsReferenceToVideo: true, supportsTextToVideo: true
    })).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('storyboard first') });

    const storyboard = assignStoryboardReference(withStyle.document, {
      shotId: shot.id, assetId: 'asset-board', referenceId: 'ref-board', label: 'Storyboard'
    });
    if (!storyboard.ok) throw new Error(storyboard.reason);
    expect(planProductionVideoReferences(storyboard.document, shot.id, {
      controls, supportsImageToVideo: true, supportsReferenceToVideo: true, supportsTextToVideo: true
    })).toMatchObject({ kind: 'storyboard', reference: { id: 'ref-board' } });

    expect(planProductionVideoReferences(withCharacter.document, shot.id, {
      controls, supportsImageToVideo: true, supportsReferenceToVideo: false, supportsTextToVideo: true
    })).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('cannot use the approved character references') });
  });

  it('carries the approved Writer visual style into every production image brief', () => {
    const styled = project({
      ...request,
      videoStyle: 'traditional-2d-cel-animation',
      customVideoStyle: 'Muted ochre paper texture and hand-inked outlines.'
    });
    const character = styled.characters[0];
    const shot = styled.shots[0];
    if (!character || !shot) throw new Error('fixture missing');
    const characterBrief = buildCharacterReferenceImageBrief(styled, character.id);
    const storyboardBrief = buildStoryboardImageBrief(styled, shot.id);
    expect(characterBrief.ok && characterBrief.brief).toMatchObject({
      stylePreset: 'Traditional 2D Cel Animation',
      styleSource: 'writer'
    });
    expect(storyboardBrief.ok && storyboardBrief.brief.styleDescription).toContain('hand-drawn linework');
    expect(storyboardBrief.ok && storyboardBrief.brief.prompt).toContain('Muted ochre paper texture');
    expect(storyboardBrief.ok && storyboardBrief.brief.prompt).not.toContain('Cinematic production image');
  });

  it('plans only missing images and shots without active or reviewable video takes', () => {
    const base = project();
    expect(missingProductionImageTargets(base, 'character_reference')).toHaveLength(1);
    expect(missingProductionImageTargets(base, 'storyboard')).toHaveLength(2);
    expect(batchableProductionVideoShotIds(base)).toEqual(base.shots.map((shot) => shot.id));

    const firstShot = base.shots[0]!;
    const withRunning = {
      ...base,
      shots: base.shots.map((shot, index) => index === 0 ? { ...shot, generationIds: ['running-take'] } : shot),
      generations: [{
        id: 'running-take', shotId: firstShot.id, providerId: 'gemini_veo', modelId: 'veo',
        capability: 'text_to_video' as const, status: 'running' as const, prompt: 'running',
        referenceAssetIds: [], outputAssetIds: [], createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:01.000Z'
      }]
    };
    expect(batchableProductionVideoShotIds(withRunning)).toEqual([base.shots[1]!.id]);
  });

  it('attaches a reviewed generated image to its snapshotted production target', () => {
    const base = project();
    const [character] = base.characters;
    const [shot] = base.shots;
    if (!character || !shot) throw new Error('fixture missing');

    const characterResult = attachGeneratedProductionImage(base, {
      target: { kind: 'character_reference', characterId: character.id },
      assetId: 'generated-character-image',
      referenceId: 'generated-character-reference'
    });
    expect(characterResult.ok).toBe(true);
    if (!characterResult.ok) return;
    const storyboardResult = attachGeneratedProductionImage(characterResult.document, {
      target: { kind: 'storyboard', shotId: shot.id },
      assetId: 'generated-storyboard-image',
      referenceId: 'generated-storyboard-reference'
    });
    expect(storyboardResult.ok).toBe(true);
    if (!storyboardResult.ok) return;
    expect(storyboardResult.document.characters[0]?.referenceAssetIds).toContain('generated-character-reference');
    expect(productionShotRows(storyboardResult.document)[0]?.storyboardReference?.assetId).toBe('generated-storyboard-image');
  });

  it('derives ordered rows and maps storyboard plus character references without a second manifest', () => {
    const base = project();
    const [first] = base.shots;
    const [character] = base.characters;
    if (!first || !character) throw new Error('fixture missing');
    const storyboard = assignStoryboardReference(base, { shotId: first.id, assetId: 'image-board', referenceId: 'ref-board', label: 'Board' });
    expect(storyboard.ok).toBe(true);
    if (!storyboard.ok) return;
    const characterResult = addCharacterReference(storyboard.document, { characterId: character.id, assetId: 'image-character', referenceId: 'ref-character', label: 'Ari' });
    expect(characterResult.ok).toBe(true);
    if (!characterResult.ok) return;
    const rows = productionShotRows(characterResult.document);
    expect(rows.map((row) => row.state)).toEqual(['not_started', 'not_started']);
    expect(rows[0]?.storyboardReference?.assetId).toBe('image-board');
    expect(rows[0]?.characterReferenceIds).toEqual(['ref-character']);

    const cleared = clearStoryboardReference(characterResult.document, first.id);
    const removed = cleared.ok ? removeCharacterReference(cleared.document, character.id, 'ref-character') : cleared;
    expect(removed.ok && productionShotRows(removed.document)[0]?.storyboardReference).toBeUndefined();
    expect(removed.ok && removed.document.characters[0]?.referenceAssetIds).toEqual([]);
  });

  it('blocks partial assembly and appends every approved take exactly once in Writer order', () => {
    const base = approvedProject();
    expect(buildApprovedProductionAssemblyPlan({ ...base, generations: base.generations.slice(0, 1), shots: base.shots.map((shot, index) => ({ ...shot, generationIds: index === 0 ? ['generation-0'] : [] })) }, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 }
    ])).toMatchObject({ ok: false, reason: expect.stringContaining('does not have an approved candidate') });

    const plan = buildApprovedProductionAssemblyPlan(base, [
      { id: 'video-0', kind: 'video', durationMs: 4_100 },
      { id: 'video-1', kind: 'video', durationMs: 3_900 }
    ]);
    expect(plan).toMatchObject({ ok: true, totalDurationMs: 8_000 });
    if (!plan.ok) return;
    const assembled = assembleApprovedProductionCut({
      timeline: createInitialTimeline(), plan, targetTrackId: 'video-track-1', clipIdForShot: (id) => `clip-${id}`
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.timeline.tracks[0]?.clips.map((clip) => [clip.assetId, clip.timelineStartMs])).toEqual([
      ['video-0', 0], ['video-1', 4_100]
    ]);
    expect(assembleApprovedProductionCut({
      timeline: assembled.timeline, plan, targetTrackId: 'video-track-1', clipIdForShot: (id) => `again-${id}`
    })).toMatchObject({ ok: false, reason: expect.stringContaining('already on the timeline') });
  });

  it('rejects reused output assets and leaves the input timeline unchanged after a placement failure', () => {
    const base = approvedProject();
    const reused = {
      ...base,
      generations: base.generations.map((generation) => ({ ...generation, outputAssetIds: ['video-0'] }))
    };
    expect(buildApprovedProductionAssemblyPlan(reused, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 }
    ])).toMatchObject({ ok: false, reason: expect.stringContaining('reuses an approved video') });

    const plan = buildApprovedProductionAssemblyPlan(base, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 },
      { id: 'video-1', kind: 'video', durationMs: 4_000 }
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const original = createInitialTimeline();
    const result = assembleApprovedProductionCut({
      timeline: original, plan, targetTrackId: 'video-track-1', clipIdForShot: () => 'duplicate-clip-id'
    });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('overlapping or duplicating') });
    expect(original.tracks[0]?.clips).toEqual([]);
  });

  it('does not present a rejected completed take as still awaiting review', () => {
    const base = approvedProject();
    const rejected = {
      ...base,
      generations: base.generations.map((generation, index) => index === 0 ? {
        ...generation,
        review: { ...generation.review, decision: 'rejected' as const }
      } : generation)
    };
    expect(productionShotRows(rejected).map((row) => row.state)).toEqual(['failed', 'approved']);
  });
});
