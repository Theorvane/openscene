import { describe, expect, it } from 'vitest';

import {
  createEmptyAiProjectDocument,
  parseAiProjectDocument,
  parseSaveAiProjectDocumentInput,
  removeAssetFromAiProjectDocument,
  type AiProjectDocument
} from '../src/shared/aiProjectDomain';

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
      createdAt: CREATED, updatedAt: CREATED, provenanceId: 'provenance-1', estimatedCostUsd: 1.25
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
});
