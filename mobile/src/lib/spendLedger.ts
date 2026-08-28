import { Directory, File, Paths } from 'expo-file-system';

import {
  chargeEntry,
  checkSpend,
  entriesInMonth,
  entryFor,
  releaseEntry,
  settleStale,
  totalOf,
  type GenerationSpendView,
  type SpendEntry
} from '@openvideo/shared/generationSpend';
import type { CostEstimate } from '@openvideo/shared/mediaGenerationPricing';

/**
 * What generation has cost on this phone, and the ceiling on it.
 *
 * The spend prompt asks before a charge and remembers "always" per feature —
 * and once someone has answered always, nothing bounded it again. This is the
 * bound: a record of every charge and a monthly limit, checked by the same
 * shared rule the desktop uses, because a ceiling only one surface honours is
 * not a ceiling.
 *
 * A file beside the permissions, for the same reason they are on disk: a limit
 * that forgets when the app is killed is not a limit.
 *
 * Reserving is one synchronous read-check-write, so two taps or two shots in a
 * sequence cannot both read the same total and both pass. A check that is not
 * joined to what it permits is not a limit either; it holds for one job at a
 * time and for no other number.
 */

/**
 * How long a reservation may sit unsettled before it counts as a charge.
 * Long enough for the slowest shot anyone waits for, short enough that an app
 * killed mid-generation does not hold room for the rest of the month.
 */
const RESERVATION_STALE_AFTER_MS = 6 * 60 * 60 * 1_000;

const FILE = new File(new Directory(Paths.document), 'generation-spend.json');

type Stored = { capUsd?: number; entries: readonly SpendEntry[] };

function read(): Stored {
  try {
    if (!FILE.exists) return { entries: [] };
    const parsed = JSON.parse(FILE.textSync()) as Partial<Stored>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      ...(typeof parsed.capUsd === 'number' && parsed.capUsd > 0 ? { capUsd: parsed.capUsd } : {})
    };
  } catch {
    // A ledger that will not parse reads as empty. No record is not a spent
    // record, and the alternative is an app that cannot generate at all.
    return { entries: [] };
  }
}

function write(next: Stored): void {
  try {
    FILE.write(JSON.stringify(next));
  } catch {
    // A charge that cannot be written down must not take the generation with
    // it. The user still saw the estimate and approved it.
  }
}

export function spendView(nowIso: string): GenerationSpendView {
  const stored = read();
  return {
    total: totalOf(entriesInMonth(stored.entries, nowIso)),
    ...(stored.capUsd === undefined ? {} : { capUsd: stored.capUsd })
  };
}

export function setSpendCap(capUsd: number | null): GenerationSpendView {
  const stored = read();
  const next: Stored =
    capUsd === null || !Number.isFinite(capUsd) || capUsd <= 0
      ? { entries: stored.entries }
      : { entries: stored.entries, capUsd };
  write(next);
  return spendView(new Date().toISOString());
}

export type SpendReservation =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Check the ceiling and take the room out of it, in one step.
 *
 * The room is held rather than spent: `chargeReservation` keeps it once the
 * request has gone to the provider, `releaseReservation` hands it back when it
 * never did.
 */
export function reserveAgainstCap(estimate: CostEstimate, nowIso: string, acceptUnpriced?: boolean): SpendReservation {
  const stored = read();
  const entries = settleStale(stored.entries, nowIso, RESERVATION_STALE_AFTER_MS);
  const check = checkSpend({
    entries,
    ...(stored.capUsd === undefined ? {} : { capUsd: stored.capUsd }),
    estimate,
    nowIso,
    ...(acceptUnpriced === undefined ? {} : { acceptUnpriced })
  });
  if (!check.allowed) {
    write({ ...stored, entries });
    return { ok: false, reason: check.reason };
  }
  // Unique without a crypto dependency: the clock plus randomness, and the id
  // never leaves this device.
  const id = `charge-${nowIso}-${Math.random().toString(36).slice(2, 10)}`;
  write({ ...stored, entries: [...entries, entryFor(estimate, nowIso, id)] });
  return { ok: true, id };
}

/** The request went out, so the charge stands. */
export function chargeReservation(id: string): void {
  const stored = read();
  write({ ...stored, entries: chargeEntry(stored.entries, id) });
}

/**
 * The request never went out, so the room goes back. Safe to call either way:
 * a reservation already charged is left alone.
 */
export function releaseReservation(id: string): void {
  const stored = read();
  write({ ...stored, entries: releaseEntry(stored.entries, id) });
}
