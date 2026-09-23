import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { productionEditorItems } from '../src/shared/productionEditor';
describe('production editor navigator', () => {
  it('does not fabricate media or timing for an empty project', () => {
    expect(productionEditorItems(createEmptyAiProjectDocument(), [])).toEqual([]);
  });
  it('retains missing-media prompts, deduplicates saved media and labels unplaced audio honestly', () => {
    const recipe = { id: 'r', assetId: 'v', prompt: 'Exact prompt\n 한국어', modelId: 'm', providerId: 'p', operation: 'text_to_video' as const, durationSeconds: 5, aspectRatio: '16:9', createdAt: '2026-09-23' };
    const doc = { ...createEmptyAiProjectDocument(), videoHistory: [recipe] };
    const before = JSON.stringify(doc);
    const assets = [{ id: 'v', kind: 'video', displayName: 'Take' }, { id: 'a', kind: 'audio', displayName: 'Voice' }];
    const items = productionEditorItems(doc, assets);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ prompt: recipe.prompt, recipeId: 'r', assetId: 'v', status: 'Unplaced take' });
    expect(items.every(item => item.startMs === undefined)).toBe(true);
    expect(items[1]?.lane).toBe('voice');
    const missing = productionEditorItems(doc, []);
    expect(missing[0]?.assetId).toBeUndefined();
    expect(missing[0]?.prompt).toBe(recipe.prompt);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('uses actual narration cue times without inventing an audio placement', () => {
    const doc = { ...createEmptyAiProjectDocument(), narrationPlan: { sourceFingerprint: '12345678', script: 'Hello', voiceModelId: 'm', voiceId: 'v', status: 'draft' as const, cues: [{ id: 'c', text: 'Hello', startMs: 1200, endMs: 2800 }] } };
    expect(productionEditorItems(doc, [])).toEqual([{ id: 'cue:c', lane: 'subtitles', label: 'Hello', prompt: 'Hello', startMs: 1200, durationMs: 1600, status: 'Planned caption' }]);
  });
});
