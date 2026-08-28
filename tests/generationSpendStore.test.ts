import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GenerationSpendStore, parseLedger, pruneEntries } from '../src/main/generationSpendStore';
import { estimateImageCost, estimateSpeechCost, estimateVideoCost } from '../src/shared/mediaGenerationPricing';
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
    const reservation = await store.reserve(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 8 }));
    expect(reservation.ok).toBe(true);

    const reopened = new GenerationSpendStore(filePath, now);
    expect(await reopened.read()).toMatchObject({ capUsd: 25 });
    expect(await reopened.monthToDate()).toEqual({ amountUsd: 0.8, entryCount: 1, unpricedCount: 0 });
  });

  it('setting the ceiling does not lose what has already been spent', async () => {
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    await store.reserve(estimateImageCost({ modelId: 'gpt-image-1', imageCount: 1 }));
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
          entries: [
            { id: 'a', state: 'charged', at: '2026-08-01T00:00:00.000Z', kind: 'video', modelId: 'sora-2', basis: '' },
            { nonsense: true }
          ]
        })
      )
    ).toEqual({
      capUsd: 10,
      entries: [{ id: 'a', state: 'charged', at: '2026-08-01T00:00:00.000Z', kind: 'video', modelId: 'sora-2', basis: '' }]
    });
    // A ceiling of zero or below is no ceiling, not a ceiling of nothing.
    expect(parseLedger(JSON.stringify({ capUsd: 0, entries: [] })).capUsd).toBeUndefined();
  });

  it('reads a file written by an older build without losing its charges', async () => {
    await writeFile(
      join(directory, 'legacy.json'),
      // No state on it: an entry written before reservations existed is a
      // charge, not a reservation nobody settled.
      JSON.stringify({ entries: [{ id: 'legacy-1', at: '2026-08-02T00:00:00.000Z', kind: 'speech', modelId: 'eleven_v3', basis: '' }] }),
      'utf8'
    );
    const store = new GenerationSpendStore(join(directory, 'legacy.json'), () => new Date('2026-08-28T09:00:00.000Z'));
    expect(await store.monthToDate()).toEqual({ amountUsd: 0, entryCount: 1, unpricedCount: 1 });
  });

  it('drops charges no ceiling can be measured against any more', () => {
    const entries: readonly SpendEntry[] = [
      { id: 'old', state: 'charged', at: '2024-01-05T00:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 1, basis: '' },
      { id: 'new', state: 'charged', at: '2026-08-05T00:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 1, basis: '' }
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

  it('holds the ceiling when jobs are asked for at the same moment', async () => {
    // The defect this is here for: two requests both read the same total, both
    // pass the check, and both spend. A ceiling that holds for one job at a
    // time is not a ceiling.
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    await store.setCap(1);

    const oneImage = estimateImageCost({ modelId: 'imagen-4.0-ultra-generate-001', imageCount: 10 }); // $0.60
    const [first, second] = await Promise.all([store.reserve(oneImage), store.reserve(oneImage)]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const refused = first.ok ? second : first;
    expect(refused.ok === false && refused.reason).toContain('over your $1.00 monthly limit');
    expect(await store.monthToDate()).toMatchObject({ amountUsd: 0.6, entryCount: 1 });
  });

  it('does not lose a charge when several are written at once', async () => {
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    const image = estimateImageCost({ modelId: 'gpt-image-1', imageCount: 1 });
    await Promise.all([store.reserve(image), store.reserve(image), store.reserve(image), store.reserve(image)]);
    // A read-modify-write on a file drops whichever came second unless the
    // operations are serialized.
    expect(await store.monthToDate()).toMatchObject({ entryCount: 4, amountUsd: 0.16 });
  });

  it('hands the room back for a job that never reached a provider', async () => {
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    const reservation = await store.reserve(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 30 }));
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;

    await store.release(reservation.id);
    expect(await store.monthToDate()).toMatchObject({ entryCount: 0, amountUsd: 0 });

    // And once it has gone out, releasing is a no-op rather than a refund.
    const second = await store.reserve(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 30 }));
    if (!second.ok) return;
    await store.charge(second.id);
    await store.release(second.id);
    expect(await store.monthToDate()).toMatchObject({ entryCount: 1, amountUsd: 3 });
  });

  it('refuses an unpriced model under a ceiling, and takes it when the user does', async () => {
    const store = new GenerationSpendStore(filePath, () => new Date('2026-08-28T09:00:00.000Z'));
    await store.setCap(10);
    const speech = estimateSpeechCost({ modelId: 'eleven_v3' });

    const refused = await store.reserve(speech);
    expect(refused.ok).toBe(false);
    expect(await store.monthToDate()).toMatchObject({ entryCount: 0 });

    const taken = await store.reserve(speech, true);
    expect(taken.ok).toBe(true);
    expect(await store.monthToDate()).toMatchObject({ entryCount: 1, unpricedCount: 1, amountUsd: 0 });
  });

  it('settles a reservation the app never came back for', async () => {
    let clock = new Date('2026-08-28T09:00:00.000Z');
    const store = new GenerationSpendStore(filePath, () => clock);
    const reservation = await store.reserve(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 10 }));
    expect(reservation.ok).toBe(true);

    // Seven hours later, still pending: it is treated as spent rather than
    // holding room in the ceiling for the rest of the month.
    clock = new Date('2026-08-28T16:00:00.000Z');
    await store.reserve(estimateImageCost({ modelId: 'gpt-image-1', imageCount: 1 }));
    const ledger = await store.read();
    expect(ledger.entries.filter((entry) => entry.state === 'pending')).toHaveLength(1);
    expect(ledger.entries.find((entry) => entry.kind === 'video')?.state).toBe('charged');
  });
});
