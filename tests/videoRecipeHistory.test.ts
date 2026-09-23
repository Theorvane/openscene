import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument, parseAiProjectDocument, removeAssetFromAiProjectDocument } from '../src/shared/aiProjectDomain';
import { parseVideoRecipeHistory, recordVideoRecipe, type VideoRecipe } from '../src/shared/videoRecipeHistory';

const recipe: VideoRecipe = { id: 'job-1', assetId: 'video-1', prompt: '민지가 문을 연다.\n누구 있어요?',
  modelId: 'model-1', providerId: 'provider-1', operation: 'text_to_video', durationSeconds: 5,
  aspectRatio: '16:9', createdAt: '2026-09-23T00:00:00.000Z' };
describe('durable video recipes', () => {
  it('roundtrips exact prompt and associated video through project validation', () => {
    const document = recordVideoRecipe(createEmptyAiProjectDocument(),recipe);
    expect(parseAiProjectDocument(JSON.parse(JSON.stringify(document)),new Set(['video-1']))?.videoHistory).toEqual([recipe]);
  });
  it('continues to read old projects without history', () => {
    expect(parseAiProjectDocument(createEmptyAiProjectDocument())?.videoHistory).toBeUndefined();
  });
  it('keeps original records when saving a regenerated child', () => {
    const first = recordVideoRecipe(createEmptyAiProjectDocument(),recipe);
    const child = {...recipe,id:'job-2',assetId:'video-2',prompt:'Revised prompt',parentId:recipe.id};
    const next = recordVideoRecipe(first,child);
    expect(next.videoHistory).toEqual([recipe,child]);
    expect(first.videoHistory).toEqual([recipe]);
    expect(next.generations).toEqual([]);
  });
  it('is idempotent and cannot silently overwrite a saved prompt', () => {
    const document = recordVideoRecipe(createEmptyAiProjectDocument(),recipe);
    expect(recordVideoRecipe(document,{...recipe,prompt:'Overwrite'})).toBe(document);
  });
  it('keeps the recipe usable after the media is deleted', () => {
    const document = removeAssetFromAiProjectDocument(recordVideoRecipe(createEmptyAiProjectDocument(),recipe),'video-1');
    expect(parseAiProjectDocument(document,new Set())?.videoHistory).toEqual([recipe]);
  });
  it.each([
    {prompt: ''}, {durationSeconds: NaN}, {durationSeconds: -1}, {operation: 'shell'},
    {aspectRatio: '../../file'}, {createdAt: 'bad'}, {parentId: 'job-1'}, {apiKey:'secret'},
    {assetId: '../video'}, {prompt:'x'.repeat(100001)}
  ])('rejects malformed or secret-bearing recipe %j', patch => {
    expect(parseVideoRecipeHistory([{...recipe,...patch}])).toBeNull();
  });
  it('allows the supported promptless motion workflow', () => {
    expect(parseVideoRecipeHistory([{...recipe,prompt:'',operation:'motion_control'}])).not.toBeNull();
  });
  it('rejects duplicate IDs and unbounded histories', () => {
    expect(parseVideoRecipeHistory([recipe,recipe])).toBeNull();
    expect(parseVideoRecipeHistory(Array(10001).fill(recipe))).toBeNull();
  });
});
