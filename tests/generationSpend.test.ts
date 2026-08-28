import { describe, expect, it } from 'vitest';

import {
  chargeEntry,
  checkSpend,
  describeSpend,
  entriesInMonth,
  entryFor,
  releaseEntry,
  settleStale,
  totalOf,
  type SpendEntry
} from '../src/shared/generationSpend';
import { estimateImageCost, estimateSpeechCost, estimateVideoCost } from '../src/shared/mediaGenerationPricing';

const august: readonly SpendEntry[] = [
  { id: 'a', state: 'charged', at: '2026-08-02T10:00:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 0.8, basis: '8s × $0.10/s' },
  { id: 'b', state: 'charged', at: '2026-08-11T10:00:00.000Z', kind: 'image', modelId: 'gpt-image-1', amountUsd: 0.04, basis: '1 × $0.04/image' },
  { id: 'c', state: 'charged', at: '2026-07-31T23:59:00.000Z', kind: 'video', modelId: 'sora-2', amountUsd: 9, basis: '90s × $0.10/s' }
];

describe('what generation has cost', () => {
  it('counts the month the job is being asked for, not everything ever spent', () => {
    const thisMonth = entriesInMonth(august, '2026-08-28T09:00:00.000Z');
    expect(thisMonth).toHaveLength(2);
    expect(totalOf(thisMonth)).toEqual({ amountUsd: 0.84, entryCount: 2, unpricedCount: 0 });
  });

  it('counts an unpriced charge as a job without pretending it was free', () => {
    const withUnknown = [
      ...august,
      { id: 'd', state: 'charged', at: '2026-08-20T10:00:00.000Z', kind: 'speech', modelId: 'eleven_v3', basis: '' } as SpendEntry
    ];
    const total = totalOf(entriesInMonth(withUnknown, '2026-08-28T09:00:00.000Z'));
    expect(total).toEqual({ amountUsd: 0.84, entryCount: 3, unpricedCount: 1 });
    expect(describeSpend(total, 10)).toContain('floor');
    expect(describeSpend(total, 10)).toContain('limit $10.00');
  });
});

describe('the ceiling', () => {
  const nowIso = '2026-08-28T09:00:00.000Z';

  it('allows anything when no ceiling is set, which is the default', () => {
    const check = checkSpend({
      entries: august,
      estimate: estimateVideoCost({ modelId: 'veo-3.1-generate-preview', durationSeconds: 60 }),
      nowIso
    });
    expect(check).toEqual({ allowed: true, spentUsd: 0.84 });
  });

  it('refuses the job that would cross the ceiling and says by how much', () => {
    // $0.84 spent, a $4.00 job, a $4.00 limit.
    const check = checkSpend({
      entries: august,
      capUsd: 4,
      estimate: estimateVideoCost({ modelId: 'sora-2-pro', durationSeconds: 13.4 }),
      nowIso
    });
    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.reason).toContain('over your $4.00 monthly limit');
    expect(check.reason).toContain('$0.84 spent so far');
    expect(check.spentUsd).toBe(0.84);
  });

  it('allows the job that fits, and says what is left', () => {
    const check = checkSpend({
      entries: august,
      capUsd: 10,
      estimate: estimateImageCost({ modelId: 'gpt-image-1', imageCount: 4 }),
      nowIso
    });
    expect(check).toEqual({ allowed: true, spentUsd: 0.84, remainingUsd: 9 });
  });

  it('refuses a charge nobody can price rather than letting it past the ceiling', () => {
    // Speech is unpriced on purpose: ElevenLabs bills against an allowance, so
    // a dollars-per-word figure would be fiction. A charge that cannot be
    // priced cannot be kept under a limit either.
    const check = checkSpend({
      entries: august,
      capUsd: 10,
      estimate: estimateSpeechCost({ modelId: 'eleven_v3' }),
      nowIso
    });
    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.reason).toContain('no recorded price');
    expect(check.reason).toContain('remove the limit');
  });

  it('lets the user take an unknown charge deliberately', () => {
    const check = checkSpend({
      entries: august,
      capUsd: 10,
      estimate: estimateSpeechCost({ modelId: 'eleven_v3' }),
      nowIso,
      acceptUnpriced: true
    });
    expect(check).toMatchObject({ allowed: true, remainingUsd: 9.16 });
  });

  it('warns that the figure is a floor when earlier charges could not be priced', () => {
    const check = checkSpend({
      entries: [...august, { id: 'd', state: 'charged', at: '2026-08-20T10:00:00.000Z', kind: 'speech', modelId: 'eleven_v3', basis: '' }],
      capUsd: 1,
      estimate: estimateImageCost({ modelId: 'gpt-image-1', imageCount: 10 }),
      nowIso
    });
    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.reason).toContain('could not be priced');
  });
});

describe('the entry written after a charge', () => {
  it('records what was charged for, and leaves an unknown amount out rather than calling it zero', () => {
    const priced = entryFor(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 8 }), '2026-08-28T09:00:00.000Z', 'charge-1');
    expect(priced).toEqual({
      id: 'charge-1',
      // Reserved, not yet spent: the room is held until the request goes out.
      state: 'pending',
      at: '2026-08-28T09:00:00.000Z',
      kind: 'video',
      modelId: 'sora-2',
      amountUsd: 0.8,
      basis: '8s × $0.10/s'
    });

    const unpriced = entryFor(estimateSpeechCost({ modelId: 'eleven_v3' }), '2026-08-28T09:00:00.000Z', 'charge-2');
    expect(unpriced.amountUsd).toBeUndefined();
    expect(Object.keys(unpriced)).not.toContain('amountUsd');
  });
});

describe('reservations', () => {
  const pending: SpendEntry = {
    id: 'in-flight',
    state: 'pending',
    at: '2026-08-28T08:55:00.000Z',
    kind: 'video',
    modelId: 'sora-2',
    amountUsd: 5,
    basis: '50s × $0.10/s'
  };

  it('counts room already taken, so two jobs at once cannot both fit under the ceiling', () => {
    // This is the whole point of holding the room: the second job sees the
    // first one's reservation, not the total from before it started.
    const check = checkSpend({
      entries: [...august, pending],
      capUsd: 6,
      estimate: estimateVideoCost({ modelId: 'sora-2', durationSeconds: 20 }),
      nowIso: '2026-08-28T09:00:00.000Z'
    });
    expect(check.allowed).toBe(false);
  });

  it('hands the room back when the request never went out', () => {
    const after = releaseEntry([...august, pending], 'in-flight');
    expect(after).toHaveLength(august.length);
    // A charge is not a reservation and is never taken back by a release.
    expect(releaseEntry(august, 'a')).toHaveLength(august.length);
  });

  it('keeps the room once the request has gone out', () => {
    const after = chargeEntry([...august, pending], 'in-flight');
    expect(after.find((entry) => entry.id === 'in-flight')?.state).toBe('charged');
  });

  it('treats a reservation nobody settled as a charge rather than holding it forever', () => {
    const stale = settleStale([pending], '2026-08-28T20:00:00.000Z', 6 * 60 * 60 * 1_000);
    expect(stale[0]!.state).toBe('charged');
    // One still in flight is left alone.
    const fresh = settleStale([pending], '2026-08-28T09:00:00.000Z', 6 * 60 * 60 * 1_000);
    expect(fresh[0]!.state).toBe('pending');
  });
});
