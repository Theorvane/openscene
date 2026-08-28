import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { entriesInMonth, totalOf, type SpendEntry, type SpendTotal } from '../shared/generationSpend';

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
 */

const MONTHS_KEPT = 13;

export type SpendLedger = {
  readonly capUsd?: number;
  readonly entries: readonly SpendEntry[];
};

function isEntry(value: unknown): value is SpendEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
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

export class GenerationSpendStore {
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(filePath: string, now: () => Date = () => new Date()) {
    this.filePath = filePath;
    this.now = now;
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
    const ledger = await this.read();
    const next: SpendLedger =
      capUsd === null || !Number.isFinite(capUsd) || capUsd <= 0
        ? { entries: ledger.entries }
        : { entries: ledger.entries, capUsd };
    await this.write(next);
    return next;
  }

  /**
   * Append a charge. Called once the job has actually been handed to a
   * provider, because that is the moment the money is committed — recording it
   * earlier would charge the user for a request that was refused before it left
   * the machine.
   */
  async record(entry: SpendEntry): Promise<SpendLedger> {
    const ledger = await this.read();
    const next: SpendLedger = {
      ...(ledger.capUsd === undefined ? {} : { capUsd: ledger.capUsd }),
      entries: [...pruneEntries(ledger.entries, entry.at), entry]
    };
    await this.write(next);
    return next;
  }

  private async write(ledger: SpendLedger): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(ledger, null, 2), 'utf8');
  }
}
