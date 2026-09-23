import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument, type AiProjectDocument, type GenerationRecord } from '../src/shared/aiProjectDomain';
import { appendProductionMemory, buildProductionMemory, MEMORY_LIMITS, searchProductionMemory } from '../src/shared/productionMemory';

function document(): AiProjectDocument {
  return { ...createEmptyAiProjectDocument(),
    characters: [{ id: 'hero', name: '민지', invariantDescription: '빨간 코트와 조용한 목소리', referenceAssetIds: [] }],
    scripts: [
      { id: 'old', title: 'Old', screenplay: 'obsolete dragon', sourceText: '', sourceKind: 'idea', status: 'superseded', createdAt: '2026-01-01' },
      { id: 'current', title: 'Current', screenplay: '민지가 문을 연다. 누구 있어요?', sourceText: '', sourceKind: 'idea', status: 'approved', createdAt: '2026-02-01' }
    ],
    scenes: [{ id: 'scene', scriptVersionId: 'current', order: 0, title: 'Doorway', objective: 'Find friend', setting: 'old house', timeOfDay: 'night', characterIds: ['hero'], shotIds: ['shot'], continuityNotes: 'Keep red coat' }],
    shots: [{ id: 'shot', sceneId: 'scene', order: 0, durationMs: 5000, framing: 'closeup', cameraMotion: 'static', action: 'Opens door', dialogue: '누구 있어요?', audioCues: ['door creak'], negativePrompt: 'No wardrobe changes', referenceAssetIds: [], generationIds: [] }]
  };
}
const candidate = (id: string, decision: 'approved' | 'rejected', status: 'completed' | 'failed' = 'completed'): GenerationRecord => ({
  id, shotId: 'shot', providerId: 'provider', modelId: 'model', capability: 'text_to_video', status,
  prompt: id + ' prompt', referenceAssetIds: [], outputAssetIds: [], createdAt: '2026-02-01', updatedAt: '2026-02-01',
  review: { decision, notes: '', continuity: { identity: 'pass', wardrobeProps: 'pass', settingPalette: 'pass', motionDirection: 'pass', boundaryMatch: 'pass' } }
});
describe('project-local production memory', () => {
  it('retrieves Korean character and dialogue excerpts with citations', () => {
    const index = buildProductionMemory('p', document());
    expect(searchProductionMemory(index, 'p', '민지')[0]?.sourceId).toBe('character/hero:0');
    expect(searchProductionMemory(index, 'p', '누구')[0]?.text).toContain('누구 있어요');
  });
  it('supports partial Korean words and case-insensitive English', () => {
    const index = buildProductionMemory('p', document());
    expect(searchProductionMemory(index, 'p', '목소리가').length).toBeGreaterThan(0);
    expect(searchProductionMemory(index, 'p', 'DOOR')[0]?.text.toLowerCase()).toContain('door');
  });
  it('never returns another project or empty-query results', () => {
    const index = buildProductionMemory('p', document());
    expect(searchProductionMemory(index, 'other', '민지')).toEqual([]);
    expect(searchProductionMemory(index, 'p', '  !!! ')).toEqual([]);
  });
  it('excludes superseded scripts and their scenes', () => {
    const doc = document();
    const index = buildProductionMemory('p', { ...doc, scenes: [...doc.scenes, { ...doc.scenes[0]!, id: 'oldScene', scriptVersionId: 'old', title: 'obsolete dragon' }] });
    expect(searchProductionMemory(index, 'p', 'obsolete')).toEqual([]);
  });
  it('includes only completed approved generation candidates', () => {
    const index = buildProductionMemory('p', { ...document(), generations: [candidate('accepted', 'approved'), candidate('rejected', 'rejected'), candidate('failed', 'approved', 'failed')] });
    expect(searchProductionMemory(index, 'p', 'accepted')[0]?.sourceId).toBe('generation/accepted:0');
    expect(searchProductionMemory(index, 'p', 'rejected')).toEqual([]);
    expect(searchProductionMemory(index, 'p', 'failed')).toEqual([]);
  });
  it('disables retrieval after Writer approval is revoked', () => {
    const doc = { ...document(), writerPipeline: { requestJson: '{}', artifacts: [] } };
    expect(buildProductionMemory('p', doc).entries).toEqual([]);
  });
  it('excludes orphaned candidates and earlier approved script versions', () => {
    const doc = document();
    const index = buildProductionMemory('p', { ...doc, shots: [], generations: [candidate('orphaned', 'approved')],
      scripts: doc.scripts.map(script => ({ ...script, status: 'approved' })) });
    expect(searchProductionMemory(index, 'p', 'orphaned')).toEqual([]);
    expect(searchProductionMemory(index, 'p', 'obsolete')).toEqual([]);
  });
  it('limits corpus and source lengths and reports truncation', () => {
    const doc = document();
    const index = buildProductionMemory('p', { ...doc, characters: Array.from({length: 30}, (_,i) => ({...doc.characters[0]!, id: String(i), invariantDescription: 'x'.repeat(13000)})) });
    expect(index.truncated).toBe(true);
    expect(index.entries.length).toBe(MEMORY_LIMITS.chunks);
    expect(index.entries.every(entry => entry.text.length <= MEMORY_LIMITS.chunkChars)).toBe(true);
  });
  it('returns at most five deterministic matches', () => {
    const doc = document();
    const index = buildProductionMemory('p', {...doc, characters: Array.from({length:10},(_,i)=>({...doc.characters[0]!,id:String(i)}))});
    const results = searchProductionMemory(index,'p','민지');
    expect(results).toHaveLength(5);
    expect(searchProductionMemory(index,'p','민지')).toEqual(results);
  });
  it('rebuilds from current data, without retaining deleted material', () => {
    const doc = document();
    expect(buildProductionMemory('p',doc).entries.some(entry=>entry.sourceId.startsWith('character/'))).toBe(true);
    expect(buildProductionMemory('p',{...doc,characters:[]}).entries.some(entry=>entry.sourceId.startsWith('character/'))).toBe(false);
  });
  it('appends editable cited data without mutating the project', () => {
    const doc = document();
    const before = JSON.stringify(doc);
    const entry = buildProductionMemory('p',doc).entries[0]!;
    const result = appendProductionMemory('Film a doorway.',entry,'p');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt).toContain('[Project reference character/hero:0]');
    expect(result.prompt).toContain('Film a doorway.');
    expect(JSON.stringify(doc)).toBe(before);
    expect(appendProductionMemory(result.prompt,entry,'p').ok).toBe(false);
    expect(appendProductionMemory('',entry,'other').ok).toBe(false);
    expect(appendProductionMemory('x'.repeat(8000),entry,'p').ok).toBe(false);
  });
});
