import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GenerationSpendStore, parseLedger, pruneEntries } from '../src/main/generationSpendStore';
import type { SpendEntry } from '../src/shared/generationSpend';

describe('the spending record on disk', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openvideo-spend-'));
    filePath = join(directory, 'nested', 'generation-spend.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads as empty on a machine that has never generated', async () => {
    const store = new GenerationSpendStore(filePath);
    expect(await store.read()).toEqual({ entries: [] });
    expect(await store.monthToDate()).toEqual({ amountUsd: 0, entryCount: 0, unpricedCount: 0 });
  });

  it('keeps the ceiling and the charges across a restart', async () => {
    const now = () => new Date('2026-08-28T09:00:00.000Z');
    const store = new GenerationSpendStore(filePath, now);
    await store.setCap(25);
    await store.record({ at: '2026-08-10T09:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 0.8, basis: '8s' });

    const reopened = new GenerationSpendStore(filePath, now);
    expect(await reopened.read()).toMatchObject({ capUsd: 25 });
    expect(await reopened.monthToDate()).toEqual({ amountUsd: 0.8, entryCount: 1, unpricedCount: 0 });
  });

  it('setting the ceiling does not lose what has already been spent', async () => {
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    await store.record({ at: '2026-08-10T09:00:00.000Z', kind: 'image', modelId: 'gpt-image-1', amountUsd: 0.04, basis: '1' });
    const after = await store.setCap(5);
    expect(after.entries).toHaveLength(1);

    // And removing it keeps them too.
    const removed = await store.setCap(null);
    expect(removed.capUsd).toBeUndefined();
    expect(removed.entries).toHaveLength(1);
  });

  it('treats a corrupt file as no record rather than refusing to generate', async () => {
    expect(parseLedger('{ not json')).toEqual({ entries: [] });
    // Entries that are not entries are dropped; the ones that are survive.
    expect(
      parseLedger(
        JSON.stringify({
          capUsd: 10,
          entries: [{ at: '2026-08-01T00:00:00.000Z', kind: 'video', modelId: 'sora-2', basis: '' }, { nonsense: true }]
        })
      )
    ).toEqual({
      capUsd: 10,
      entries: [{ at: '2026-08-01T00:00:00.000Z', kind: 'video', modelId: 'sora-2', basis: '' }]
    });
    // A ceiling of zero or below is no ceiling, not a ceiling of nothing.
    expect(parseLedger(JSON.stringify({ capUsd: 0, entries: [] })).capUsd).toBeUndefined();
  });

  it('reads a file written by an older build without losing its charges', async () => {
    await writeFile(
      join(directory, 'legacy.json'),
      JSON.stringify({ entries: [{ at: '2026-08-02T00:00:00.000Z', kind: 'speech', modelId: 'eleven_v3', basis: '' }] }),
      'utf8'
    );
    const store = new GenerationSpendStore(join(directory, 'legacy.json'), () => new Date('2026-08-28T09:00:00.000Z'));
    expect(await store.monthToDate()).toEqual({ amountUsd: 0, entryCount: 1, unpricedCount: 1 });
  });

  it('drops charges no ceiling can be measured against any more', () => {
    const entries: readonly SpendEntry[] = [
      { at: '2024-01-05T00:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 1, basis: '' },
      { at: '2026-08-05T00:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 1, basis: '' }
    ];
    const kept = pruneEntries(entries, '2026-08-28T09:00:00.000Z');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.at).toBe('2026-08-05T00:00:00.000Z');
  });

  it('writes a file a person can read', async () => {
    const store = new GenerationSpendStore(filePath);
    await store.setCap(12.5);
    expect(await readFile(filePath, 'utf8')).toContain('"capUsd": 12.5');
  });
});
