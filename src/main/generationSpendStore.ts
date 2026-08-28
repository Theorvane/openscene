import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { randomUUID } from 'node:crypto';

import {
  chargeEntry,
  checkSpend,
  entriesInMonth,
  entryFor,
  releaseEntry,
  settleStale,
  totalOf,
  type SpendCheck,
  type SpendEntry,
  type SpendTotal
} from '../shared/generationSpend';
import type { CostEstimate } from '../shared/mediaGenerationPricing';

/**
 * The record of what generation has cost on this machine, and the ceiling on
 * what it may cost next.
 *
 * A file rather than memory, because the point of a monthly ceiling is that it
 * survives the app being closed — an agent loop restarted after a crash would
 * otherwise start again from zero.
 *
 * Kept small on purpose: entries older than the ceiling could ever be measured
 * against are dropped on write, so this cannot grow without bound on a machine
 * that generates every day.
 *
 * Every operation runs one at a time. Checking the ceiling and taking room out
 * of it have to be one indivisible step, or two jobs asked for at once both
 * read the same total, both pass, and both spend — and a read-modify-write on
 * a file loses whichever entry was written second. The queue below is what
 * makes reserve-then-settle mean anything.
 */

const MONTHS_KEPT = 13;

/**
 * How long a reservation may sit unsettled before it is treated as a charge.
 *
 * Long enough for the slowest generation anyone waits for, short enough that a
 * crash does not hold room in someone's ceiling for the rest of the month.
 */
const RESERVATION_STALE_AFTER_MS = 6 * 60 * 60 * 1_000;

export type SpendLedger = {
  readonly capUsd?: number;
  readonly entries: readonly SpendEntry[];
};

function isEntry(value: unknown): value is SpendEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    (entry.state === undefined || entry.state === 'pending' || entry.state === 'charged') &&
    typeof entry.at === 'string' &&
    (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'speech') &&
    typeof entry.modelId === 'string' &&
    typeof entry.basis === 'string' &&
    (entry.amountUsd === undefined || (typeof entry.amountUsd === 'number' && Number.isFinite(entry.amountUsd)))
  );
}

/** A ledger that will not parse reads as empty: no record is not a spent record. */
export function parseLedger(text: string): SpendLedger {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return { entries: [] };
    const raw = parsed as { capUsd?: unknown; entries?: unknown };
    const entries = Array.isArray(raw.entries) ? raw.entries.filter(isEntry) : [];
    const capUsd = typeof raw.capUsd === 'number' && Number.isFinite(raw.capUsd) && raw.capUsd > 0 ? raw.capUsd : undefined;
    return { entries, ...(capUsd === undefined ? {} : { capUsd }) };
  } catch {
    return { entries: [] };
  }
}

/** Drop what no ceiling can be measured against any more. */
export function pruneEntries(entries: readonly SpendEntry[], nowIso: string): readonly SpendEntry[] {
  const cutoff = new Date(nowIso);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHS_KEPT);
  const oldest = cutoff.toISOString();
  return entries.filter((entry) => entry.at >= oldest);
}

export type SpendReservation =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

export class GenerationSpendStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  /** The tail of the queue every operation joins, so none of them interleave. */
  private work: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, now: () => Date = () => new Date(), createId: () => string = randomUUID) {
    this.filePath = filePath;
    this.now = now;
    this.createId = createId;
  }

  /** Run one operation at a time, whatever any of them does or throws. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.work.then(operation, operation);
    // Failures are the caller's; the queue must not inherit them or every
    // later operation would reject with someone else's error.
    this.work = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async read(): Promise<SpendLedger> {
    try {
      return parseLedger(await readFile(this.filePath, 'utf8'));
    } catch {
      // A machine that has never generated has no file, which is not an error.
      return { entries: [] };
    }
  }

  /** The month-to-date figure a ceiling is measured against. */
  async monthToDate(): Promise<SpendTotal> {
    const ledger = await this.read();
    return totalOf(entriesInMonth(ledger.entries, this.now().toISOString()));
  }

  async setCap(capUsd: number | null): Promise<SpendLedger> {
    return this.serialize(async () => {
      const ledger = await this.read();
      const next: SpendLedger =
        capUsd === null || !Number.isFinite(capUsd) || capUsd <= 0
          ? { entries: ledger.entries }
          : { entries: ledger.entries, capUsd };
      await this.write(next);
      return next;
    });
  }

  /**
   * Check the ceiling and take the room out of it in one step.
   *
   * The room is held, not spent: `charge` keeps it once the request has gone to
   * a provider, and `release` hands it back when the job never got that far —
   * a missing key costs nothing, and billing someone's ceiling for it would
   * lock them out over a request that never left the machine.
   */
  async reserve(estimate: CostEstimate, acceptUnknownCost?: boolean): Promise<SpendReservation> {
    return this.serialize(async () => {
      const ledger = await this.read();
      const nowIso = this.now().toISOString();
      const settled = settleStale(ledger.entries, nowIso, RESERVATION_STALE_AFTER_MS);
      const check: SpendCheck = checkSpend({
        entries: settled,
        ...(ledger.capUsd === undefined ? {} : { capUsd: ledger.capUsd }),
        estimate,
        nowIso,
        ...(acceptUnknownCost === undefined ? {} : { acceptUnpriced: acceptUnknownCost })
      });
      if (!check.allowed) {
        // Still written back, so a settled reservation is not re-settled on
        // every refusal.
        await this.write({ ...ledger, entries: settled });
        return { ok: false, reason: check.reason };
      }
      const entry = entryFor(estimate, nowIso, this.createId());
      await this.write({
        ...(ledger.capUsd === undefined ? {} : { capUsd: ledger.capUsd }),
        entries: [...pruneEntries(settled, nowIso), entry]
      });
      return { ok: true, id: entry.id };
    });
  }

  /** The request went out; the reservation becomes a charge. */
  async charge(id: string): Promise<void> {
    await this.serialize(async () => {
      const ledger = await this.read();
      await this.write({ ...ledger, entries: chargeEntry(ledger.entries, id) });
    });
  }

  /** The request never went out; the room goes back. */
  async release(id: string): Promise<void> {
    await this.serialize(async () => {
      const ledger = await this.read();
      await this.write({ ...ledger, entries: releaseEntry(ledger.entries, id) });
    });
  }

  private async write(ledger: SpendLedger): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(ledger, null, 2), 'utf8');
  }
}
