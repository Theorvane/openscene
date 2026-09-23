import { describe, expect, it } from 'vitest';
import { inspectProductionTime, productionPlanDuration, productionReadiness, type ProductionEditorItem } from '../src/shared/productionEditor';
const items: readonly ProductionEditorItem[] = [
  { id: 'a', lane: 'video', label: 'A', prompt: 'A', shotId: 'a', startMs: 0, durationMs: 5000, status: 'Approved take', assetId: 'asset' },
  { id: 'b', lane: 'video', label: 'B', prompt: 'B', shotId: 'b', startMs: 5000, durationMs: 3000, status: 'Awaiting video' },
  { id: 'c', lane: 'subtitles', label: 'Line', prompt: 'Line', startMs: 3000, durationMs: 3000, status: 'Planned caption' },
  { id: 'u', lane: 'voice', label: 'Audio', prompt: '', durationMs: 100000, status: 'Unplaced media' }
];
describe('planned-time inspection', () => {
  it('uses half-open cuts and derives source-relative offsets and captions', () => {
    expect(inspectProductionTime(items, 4999).video?.id).toBe('a');
    expect(inspectProductionTime(items, 5000)).toMatchObject({ video: { id: 'b' }, sourceOffsetMs: 0, captions: [{ id: 'c' }] });
    expect(inspectProductionTime(items, 6000)).toMatchObject({ sourceOffsetMs: 1000, captions: [] });
    expect(inspectProductionTime(items, 8000).video).toBeUndefined();
  });
  it('clamps invalid/out-of-range input and ignores unplaced media in runtime', () => {
    expect(productionPlanDuration(items)).toBe(8000);
    for (const time of [NaN, Infinity, -1]) expect(inspectProductionTime(items, time).timeMs).toBe(0);
    expect(inspectProductionTime(items, 100000).timeMs).toBe(8000);
    expect(inspectProductionTime([], 100)).toMatchObject({ timeMs: 0, durationMs: 0, captions: [] });
  });
  it('reports missing, unreviewed and approved shots without making approval decisions', () => {
    expect(productionReadiness(items)).toEqual({ total: 2, missing: 1, review: 0, approved: 1 });
    expect(productionReadiness([...items, { ...items[1]!, id: 'd', assetId: 'other', status: 'Needs review' }])).toEqual({ total: 3, missing: 1, review: 1, approved: 1 });
  });
});
