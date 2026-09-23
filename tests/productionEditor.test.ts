import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { productionEditorItems } from '../src/shared/productionEditor';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
describe('production editor navigator', () => {
  it('reads real audio placements, retaining repeat clips, trim and retimed length without mutating the timeline', () => {
    const initial = createInitialTimeline();
    const clip = { id: 'one', assetId: 'a', timelineStartMs: 2000, sourceStartMs: 1000, sourceEndMs: 5000, sourceDurationMs: 6000, effects: { ...DEFAULT_CLIP_EFFECTS, speed: 2 }, keyframes: [] };
    const timeline = { ...initial, tracks: initial.tracks.map(track => track.kind === 'audio' ? { ...track, clips: [clip, { ...clip, id: 'two', timelineStartMs: 8000 }] } : track) };
    const before = JSON.stringify(timeline);
    const items = productionEditorItems(createEmptyAiProjectDocument(), [{ id: 'a', kind: 'audio', displayName: 'Voice' }, { id: 'b', kind: 'audio', displayName: 'Unused' }], timeline);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: 'clip:one', startMs: 2000, durationMs: 2000, sourceStartMs: 1000, status: 'Placed audio' });
    expect(items[1]).toMatchObject({ id: 'clip:two', startMs: 8000 });
    expect(items[2]).toMatchObject({ id: 'asset:b', status: 'Unplaced media' });
    expect(JSON.stringify(timeline)).toBe(before);
    expect(productionEditorItems(createEmptyAiProjectDocument(), [], timeline)).toEqual([]);
  });
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
