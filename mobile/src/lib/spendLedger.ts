import { Directory, File, Paths } from 'expo-file-system';

import {
  checkSpend,
  entriesInMonth,
  entryFor,
  totalOf,
  type GenerationSpendView,
  type SpendCheck,
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
 */

const FILE = new File(new Directory(Paths.document), 'generation-spend.json');

type Stored = { capUsd?: number; entries: SpendEntry[] };

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

/** Whether this job may run, given the ceiling and what the month has cost. */
export function checkAgainstCap(estimate: CostEstimate, nowIso: string, acceptUnpriced?: boolean): SpendCheck {
  const stored = read();
  return checkSpend({
    entries: stored.entries,
    ...(stored.capUsd === undefined ? {} : { capUsd: stored.capUsd }),
    estimate,
    nowIso,
    ...(acceptUnpriced === undefined ? {} : { acceptUnpriced })
  });
}

/**
 * Written once the request has actually gone to the provider, which is where
 * the money is committed. A job refused for a missing key cost nothing.
 */
export function recordCharge(estimate: CostEstimate, nowIso: string): void {
  const stored = read();
  write({ ...stored, entries: [...stored.entries, entryFor(estimate, nowIso)] });
}
