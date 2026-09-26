import { describe, expect, it } from 'vitest';

import { mediaLibraryView } from '../src/shared/mediaLibraryView';

type Asset = { id: string; displayName: string; kind: 'video' | 'audio' | 'image'; durationMs: number | null };
const assets: readonly Asset[] = [
  { id: 'z', displayName: 'Zebra.mov', kind: 'video', durationMs: 5_000 },
  { id: 'a', displayName: 'alpha.wav', kind: 'audio', durationMs: 12_000 },
  { id: 'a2', displayName: 'ALPHA.MP4', kind: 'video', durationMs: 12_000 },
  { id: 'still', displayName: 'still.png', kind: 'image', durationMs: null }
];
const durationMs = (asset: Asset): number | null => asset.durationMs;

const ids = (items: readonly Asset[]): readonly string[] => items.map((asset) => asset.id);

describe('shared project media view', () => {
  it('searches names without changing the stored order or matching case', () => {
    expect(ids(mediaLibraryView(assets, { query: ' ALPhA ', sort: 'project', durationMs }))).toEqual(['a', 'a2']);
    expect(ids(assets)).toEqual(['z', 'a', 'a2', 'still']);
  });

  it('sorts names and durations stably, keeping unknown durations last', () => {
    expect(ids(mediaLibraryView(assets, { query: '', sort: 'name', durationMs }))).toEqual(['a2', 'a', 'still', 'z']);
    expect(ids(mediaLibraryView(assets, { query: '', sort: 'duration', durationMs }))).toEqual(['a', 'a2', 'z', 'still']);
  });

  it('filters by kind before sorting, with project order available on either surface', () => {
    expect(ids(mediaLibraryView(assets, { query: '', sort: 'project', kind: 'video', durationMs }))).toEqual(['z', 'a2']);
    expect(ids(mediaLibraryView(assets, { query: '', sort: 'type', durationMs }))).toEqual(['a', 'still', 'z', 'a2']);
  });
});
