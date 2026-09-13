import { describe, expect, it } from 'vitest';

import {
  createEmptyAiProjectDocument,
  parseAiProjectDocument,
  parseSaveAiProjectDocumentInput,
  removeAssetFromAiProjectDocument,
  type AiProjectDocument
} from '../src/shared/aiProjectDomain';
import {
  addGenerationCandidate,
  decideGenerationCandidate,
  setCandidateContinuity,
  updateGenerationCandidate
} from '../src/shared/generationReview';

const CREATED = '2026-09-02T06:10:00.000Z';

function validDocument(): AiProjectDocument {
  return {
    schemaVersion: 1,
    scripts: [{
      id: 'script-1', title: 'Launch film', sourceKind: 'idea', sourceText: 'A careful launch.', screenplay: '',
      status: 'draft', createdAt: CREATED
    }],
    characters: [{ id: 'character-1', name: 'Host', invariantDescription: 'Blue jacket.', referenceAssetIds: ['reference-character'] }],
    styleBible: {
      palette: ['navy', 'warm white'], lighting: 'Soft key light.', cameraGrammar: 'Stable dolly moves.',
      texture: 'Natural film grain.', forbiddenChanges: ['Do not change the blue jacket.']
    },
    referenceAssets: [{ id: 'reference-character', assetId: 'asset-character', role: 'character', label: 'Host reference' }],
    scenes: [{
      id: 'scene-1', scriptVersionId: 'script-1', order: 0, title: 'Introduction', objective: 'Introduce the host.',
      setting: 'Studio', timeOfDay: 'Day', characterIds: ['character-1'], shotIds: ['shot-1'], continuityNotes: 'Blue jacket remains.'
    }],
    shots: [{
      id: 'shot-1', sceneId: 'scene-1', order: 0, durationMs: 8_000, framing: 'Medium', cameraMotion: 'Slow push in',
      action: 'Host turns to camera.', dialogue: 'Welcome.', audioCues: ['Room tone'], negativePrompt: 'No wardrobe changes.',
      referenceAssetIds: ['reference-character'], generationIds: ['generation-1']
    }],
    generations: [{
      id: 'generation-1', shotId: 'shot-1', providerId: 'gemini_veo', modelId: 'veo-3.1', capability: 'reference_to_video',
      status: 'completed', prompt: 'Host turns to camera.', referenceAssetIds: ['reference-character'], outputAssetIds: ['asset-output'],
      createdAt: CREATED, updatedAt: CREATED, provenanceId: 'provenance-1', estimatedCostUsd: 1.25,
      continuityControls: { characterConsistency: true, styleConsistency: true, sceneConsistency: true, motionContinuity: false }
    }],
    provenance: [{
      id: 'provenance-1', source: 'provider', createdAt: CREATED, inputAssetIds: ['asset-character'],
      outputAssetIds: ['asset-output'], transformHistory: ['Veo reference-to-video'], providerId: 'gemini_veo', modelId: 'veo-3.1'
    }]
  };
}

describe('AI project domain', () => {
  it('creates and parses a stable empty document', () => {
    const empty = createEmptyAiProjectDocument();
    expect(parseAiProjectDocument(empty)).toEqual(empty);
    expect(empty).toEqual({
      schemaVersion: 1,
      scripts: [], scenes: [], shots: [], characters: [],
      styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
      referenceAssets: [], generations: [], provenance: []
    });
  });

  it('accepts a complete graph only when referenced project assets exist', () => {
    const document = validDocument();
    expect(parseAiProjectDocument(document, new Set(['asset-character', 'asset-output']))).toEqual(document);
    expect(parseAiProjectDocument(document, new Set(['asset-character']))).toBeNull();
  });

  it('fails closed for dangling, mismatched, duplicate-order, cyclic and extra-field data', () => {
    const document = validDocument();
    expect(parseAiProjectDocument({ ...document, scenes: [{ ...document.scenes[0]!, scriptVersionId: 'missing-script' }] })).toBeNull();
    expect(parseAiProjectDocument({ ...document, shots: [{ ...document.shots[0]!, sceneId: 'missing-scene' }] })).toBeNull();
    expect(parseAiProjectDocument({ ...document, scenes: [{ ...document.scenes[0]!, shotIds: [] }] })).toBeNull();
    expect(parseAiProjectDocument({ ...document, scripts: [{ ...document.scripts[0]!, parentVersionId: 'script-1' }] })).toBeNull();
    expect(parseAiProjectDocument({
      ...document,
      generations: [{ ...document.generations[0]!, continuityControls: { characterConsistency: true } }]
    })).toBeNull();
    expect(parseAiProjectDocument({ ...document, unexpected: true })).toBeNull();
    expect(parseAiProjectDocument({
      ...document,
      scenes: [...document.scenes, { ...document.scenes[0]!, id: 'scene-2', shotIds: [] }]
    })).toBeNull();
  });

  it('canonicalizes top-level entity order without changing authored relation order', () => {
    const first = validDocument();
    const secondScript = { ...first.scripts[0]!, id: 'script-2', createdAt: '2026-09-02T06:11:00.000Z', parentVersionId: 'script-1' };
    const parsed = parseAiProjectDocument({ ...first, scripts: [secondScript, first.scripts[0]!] });
    expect(parsed?.scripts.map((script) => script.id)).toEqual(['script-1', 'script-2']);
    expect(parsed?.scenes[0]?.shotIds).toEqual(['shot-1']);
  });

  it('parses only a path-free save request with a valid project id and document', () => {
    const ai = createEmptyAiProjectDocument();
    expect(parseSaveAiProjectDocumentInput({ projectId: 'project-1', ai })).toEqual({ projectId: 'project-1', ai });
    expect(parseSaveAiProjectDocumentInput({ projectId: '../project', ai })).toBeNull();
    expect(parseSaveAiProjectDocumentInput({ projectId: 'project-1', ai, projectPath: 'C:/private' })).toBeNull();
  });

  it('removes every relation to a deleted project asset while preserving authored history', () => {
    const detached = removeAssetFromAiProjectDocument(validDocument(), 'asset-character');

    expect(detached.referenceAssets).toEqual([]);
    expect(detached.characters[0]?.referenceAssetIds).toEqual([]);
    expect(detached.shots[0]?.referenceAssetIds).toEqual([]);
    expect(detached.generations[0]?.referenceAssetIds).toEqual([]);
    expect(detached.generations[0]?.outputAssetIds).toEqual(['asset-output']);
    expect(detached.provenance[0]?.inputAssetIds).toEqual([]);
    expect(detached.scripts).toEqual(validDocument().scripts);
    expect(parseAiProjectDocument(detached, new Set(['asset-output']))).toEqual(detached);

    const withoutOutput = removeAssetFromAiProjectDocument(detached, 'asset-output');
    expect(withoutOutput.generations[0]?.outputAssetIds).toEqual([]);
    expect(withoutOutput.provenance[0]?.outputAssetIds).toEqual([]);
    expect(parseAiProjectDocument(withoutOutput, new Set())).toEqual(withoutOutput);
  });

  it('records, reviews and replaces a single approved candidate per Writer shot', () => {
    const original = validDocument();
    const first = {
      ...original,
      generations: [{ ...original.generations[0]!, review: {
        decision: 'approved' as const,
        continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const },
        notes: '', reviewedAt: CREATED
      } }]
    };
    const added = addGenerationCandidate(first, {
      id: 'generation-2', shotId: 'shot-1', providerId: 'gemini_veo', modelId: 'veo-3.1',
      capability: 'text_to_video', prompt: 'A stronger second take.', createdAt: '2026-09-02T06:12:00.000Z',
      parentGenerationId: 'generation-1'
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.document.shots[0]?.generationIds).toEqual(['generation-1', 'generation-2']);

    const completed = updateGenerationCandidate(added.document, 'generation-2', {
      status: 'completed', outputAssetIds: ['asset-output-2'], updatedAt: '2026-09-02T06:13:00.000Z'
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    let reviewed = completed.document;
    for (const field of ['identity', 'wardrobeProps', 'settingPalette', 'motionDirection', 'boundaryMatch'] as const) {
      const result = setCandidateContinuity(reviewed, 'generation-2', field, 'pass', '');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      reviewed = result.document;
    }
    const approved = decideGenerationCandidate(reviewed, 'generation-2', 'approved', '', '2026-09-02T06:14:00.000Z');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.document.generations.map((entry) => entry.review?.decision)).toEqual(['rejected', 'approved']);
    expect(parseAiProjectDocument(approved.document, new Set(['asset-character', 'asset-output', 'asset-output-2']))).toEqual(approved.document);
  });

  it('blocks approval until import and the full human continuity review are complete', () => {
    const added = addGenerationCandidate(validDocument(), {
      id: 'generation-2', shotId: 'shot-1', providerId: 'gemini_veo', modelId: 'veo-3.1',
      capability: 'text_to_video', prompt: 'Another take.', createdAt: '2026-09-02T06:12:00.000Z'
    });
    if (!added.ok) throw new Error(added.reason);
    expect(decideGenerationCandidate(added.document, 'generation-2', 'approved', '', CREATED)).toMatchObject({ ok: false, reason: 'Only a completed candidate can be approved.' });
    const completed = updateGenerationCandidate(added.document, 'generation-2', { status: 'completed', updatedAt: CREATED });
    if (!completed.ok) throw new Error(completed.reason);
    expect(decideGenerationCandidate(completed.document, 'generation-2', 'approved', '', CREATED)).toMatchObject({ ok: false, reason: 'Import the candidate into the project before approving it.' });
    const imported = updateGenerationCandidate(completed.document, 'generation-2', { outputAssetIds: ['asset-output-2'], updatedAt: CREATED });
    if (!imported.ok) throw new Error(imported.reason);
    expect(decideGenerationCandidate(imported.document, 'generation-2', 'approved', '', CREATED)).toMatchObject({ ok: false, reason: 'Review every continuity item before approval.' });
  });

  it('invalidates an approved review when its output asset is removed', () => {
    const document = validDocument();
    const reviewed = {
      ...document,
      generations: [{ ...document.generations[0]!, review: {
        decision: 'approved' as const,
        continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const },
        notes: '', reviewedAt: CREATED
      } }]
    };
    const withoutOutput = removeAssetFromAiProjectDocument(reviewed, 'asset-output');
    expect(withoutOutput.generations[0]?.review).toMatchObject({ decision: 'pending' });
    expect(withoutOutput.generations[0]?.review?.reviewedAt).toBeUndefined();
    expect(parseAiProjectDocument(withoutOutput, new Set(['asset-character']))).toEqual(withoutOutput);
  });
});
