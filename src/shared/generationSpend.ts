/**
 * What generation has cost, and a ceiling on what it may cost next.
 *
 * Both surfaces already ask before a charge — the phone with a spend prompt per
 * feature, the desktop agent in chat — and `mediaGenerationPricing` prices a
 * job before it runs. Neither had a memory or a limit. Once someone answers
 * "always", nothing bounds it again, and a loop that generates in circles is
 * discovered on a statement rather than in the app.
 *
 * So: a ledger of charges incurred, a month-to-date total, and a check that
 * refuses the job that would cross the ceiling. The rule lives here because a
 * ceiling that only one surface honours is not a ceiling.
 *
 * Two things it deliberately does not do:
 *
 * 1. It does not guess. A model with no recorded rate cannot be counted against
 *    a ceiling, so under a cap it is refused rather than waved through — the
 *    same rule `mediaGenerationPricing` follows for prices, applied to money.
 * 2. It does not bill. These are list-price estimates recorded at the moment of
 *    the charge, not amounts anyone was invoiced, and every total says so.
 */

import type { CostEstimate, GenerationKind } from './mediaGenerationPricing';

/** One charge, as it was understood when it was incurred. */
export type SpendEntry = {
  /** ISO 8601, in UTC. */
  readonly at: string;
  readonly kind: GenerationKind;
  readonly modelId: string;
  /**
   * Absent for a model with no recorded rate. Absent is not zero: a total over
   * entries like this is a floor, and `unpricedCount` says how far it may be
   * from the truth.
   */
  readonly amountUsd?: number;
  /** How the figure was reached, e.g. "8s × $0.40/s". Empty when unpriced. */
  readonly basis: string;
};

export type SpendTotal = {
  readonly amountUsd: number;
  readonly entryCount: number;
  /** Charges in the window that could not be priced, so the total is a floor. */
  readonly unpricedCount: number;
};

/** `2026-08` — the window a monthly ceiling is measured over. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function entriesInMonth(entries: readonly SpendEntry[], nowIso: string): readonly SpendEntry[] {
  const month = monthOf(nowIso);
  return entries.filter((entry) => monthOf(entry.at) === month);
}

export function totalOf(entries: readonly SpendEntry[]): SpendTotal {
  return {
    amountUsd: Math.round(entries.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0) * 100) / 100,
    entryCount: entries.length,
    unpricedCount: entries.filter((entry) => entry.amountUsd === undefined).length
  };
}

/** What a surface shows: the month so far, and the ceiling if there is one. */
export type GenerationSpendView = {
  readonly total: SpendTotal;
  readonly capUsd?: number;
};

export type SpendCheckInput = {
  readonly entries: readonly SpendEntry[];
  /** Absent or non-positive means no ceiling, which is the default. */
  readonly capUsd?: number | undefined;
  readonly estimate: CostEstimate;
  /** The moment the job is being asked for, so the month is the caller's. */
  readonly nowIso: string;
  /**
   * Whether the user has accepted a charge nobody can price. Without this an
   * unpriced job is refused under a cap, because it cannot be kept under one.
   */
  readonly acceptUnpriced?: boolean;
};

export type SpendCheck =
  | { readonly allowed: true; readonly spentUsd: number; readonly remainingUsd?: number }
  | { readonly allowed: false; readonly reason: string; readonly spentUsd: number; readonly capUsd: number };

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function checkSpend(input: SpendCheckInput): SpendCheck {
  const spent = totalOf(entriesInMonth(input.entries, input.nowIso));
  const cap = input.capUsd;

  // No ceiling is the default, and the answer then is simply what has been
  // spent so far — the caller still shows it.
  if (cap === undefined || !Number.isFinite(cap) || cap <= 0) {
    return { allowed: true, spentUsd: spent.amountUsd };
  }

  if (!input.estimate.priced || input.estimate.amountUsd === undefined) {
    if (input.acceptUnpriced === true) {
      return { allowed: true, spentUsd: spent.amountUsd, remainingUsd: Math.max(0, cap - spent.amountUsd) };
    }
    return {
      allowed: false,
      spentUsd: spent.amountUsd,
      capUsd: cap,
      reason:
        `There is no recorded price for ${input.estimate.modelId}, so this charge cannot be kept under your ` +
        `${money(cap)} monthly limit. Accept the unknown charge, choose a model with a known rate, or remove the limit.`
    };
  }

  const wouldBe = Math.round((spent.amountUsd + input.estimate.amountUsd) * 100) / 100;
  if (wouldBe > cap) {
    const over = Math.round((wouldBe - cap) * 100) / 100;
    return {
      allowed: false,
      spentUsd: spent.amountUsd,
      capUsd: cap,
      reason:
        `This would put you ${money(over)} over your ${money(cap)} monthly limit: ` +
        `${money(spent.amountUsd)} spent so far this month, and this job is about ${money(input.estimate.amountUsd)}.` +
        (spent.unpricedCount > 0
          ? ` ${spent.unpricedCount} earlier ${spent.unpricedCount === 1 ? 'charge' : 'charges'} could not be priced, so the real figure may be higher.`
          : '')
    };
  }

  return { allowed: true, spentUsd: spent.amountUsd, remainingUsd: Math.round((cap - wouldBe) * 100) / 100 };
}

/** The entry to append once the charge has actually been incurred. */
export function entryFor(estimate: CostEstimate, atIso: string): SpendEntry {
  return {
    at: atIso,
    kind: estimate.kind,
    modelId: estimate.modelId,
    ...(estimate.priced && estimate.amountUsd !== undefined ? { amountUsd: estimate.amountUsd } : {}),
    basis: estimate.basis
  };
}

/** One line for a person: what this month has cost, and how sure that is. */
export function describeSpend(total: SpendTotal, capUsd?: number): string {
  const spent = `${money(total.amountUsd)} this month across ${total.entryCount} ${total.entryCount === 1 ? 'job' : 'jobs'}`;
  const ceiling = capUsd !== undefined && capUsd > 0 ? `, limit ${money(capUsd)}` : '';
  const unsure =
    total.unpricedCount > 0
      ? ` ${total.unpricedCount} of them had no recorded price, so this is a floor rather than a figure.`
      : '';
  // Estimates, never a bill: these are list prices at the moment of the charge.
  return `About ${spent}${ceiling}.${unsure} Estimated from list prices, not from your invoice.`;
}
