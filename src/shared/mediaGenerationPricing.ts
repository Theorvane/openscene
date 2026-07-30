/**
 * List-price rates for the generation models, so a cost estimate comes from a
 * table rather than from the model's memory. A price an LLM recalls is a
 * fabrication with a currency symbol in front of it, which is the one thing a
 * spend gate cannot afford.
 *
 * Two rules follow from that and are enforced by the types below:
 *
 * 1. A model whose rate is not known is `unknown`, never a plausible guess. The
 *    agent then has to tell the user it cannot price the job.
 * 2. Every estimate carries the date the rates were recorded, because these are
 *    published list prices that change and that differ per account, region, and
 *    resolution tier.
 */

/** The day the rates below were recorded. Surfaced in every estimate. */
export const PRICING_AS_OF = '2026-07-30';

export type GenerationRate =
  | { readonly kind: 'per-second'; readonly usd: number }
  | { readonly kind: 'per-image'; readonly usd: number }
  | { readonly kind: 'unknown'; readonly reason: string };

const UNKNOWN_THIRD_PARTY: GenerationRate = {
  kind: 'unknown',
  reason: 'No list price is recorded for this model in OpenVideo.'
};

/**
 * Video rates are per second of output. Where a provider charges differently by
 * resolution or audio, the higher published tier is used so an estimate errs
 * toward over-quoting rather than under-quoting a charge the user then owes.
 */
const VIDEO_RATES: Readonly<Record<string, GenerationRate>> = {
  'veo-3.1-generate-preview': { kind: 'per-second', usd: 0.4 },
  'veo-3.0-generate-001': { kind: 'per-second', usd: 0.4 },
  'veo-3.0-fast-generate-001': { kind: 'per-second', usd: 0.15 },
  'veo-2.0-generate-001': { kind: 'per-second', usd: 0.35 },
  'sora-2': { kind: 'per-second', usd: 0.1 },
  'sora-2-pro': { kind: 'per-second', usd: 0.3 }
};

const IMAGE_RATES: Readonly<Record<string, GenerationRate>> = {
  'gpt-image-1': { kind: 'per-image', usd: 0.04 },
  'dall-e-3': { kind: 'per-image', usd: 0.04 },
  'imagen-4.0-generate-001': { kind: 'per-image', usd: 0.04 },
  'imagen-4.0-ultra-generate-001': { kind: 'per-image', usd: 0.06 },
  'imagen-3.0-generate-002': { kind: 'per-image', usd: 0.03 }
};

/**
 * Speech pricing is deliberately empty rather than approximated. ElevenLabs
 * bills against a monthly credit allowance, not per character, so a
 * dollars-per-word figure would be fiction dressed as arithmetic.
 */
const SPEECH_RATES: Readonly<Record<string, GenerationRate>> = {};

export type GenerationKind = 'video' | 'image' | 'speech';

export function rateFor(kind: GenerationKind, modelId: string): GenerationRate {
  const table = kind === 'video' ? VIDEO_RATES : kind === 'image' ? IMAGE_RATES : SPEECH_RATES;
  return table[modelId] ?? UNKNOWN_THIRD_PARTY;
}

export type CostEstimate = {
  readonly kind: GenerationKind;
  readonly modelId: string;
  /** False when the model has no recorded rate; amountUsd is then absent. */
  readonly priced: boolean;
  readonly amountUsd?: number;
  /** How the number was reached, e.g. "8s × $0.40/s". Empty when unpriced. */
  readonly basis: string;
  readonly asOf: string;
  readonly caveat: string;
};

const LIST_PRICE_CAVEAT =
  `List price recorded ${PRICING_AS_OF}; your actual rate can differ by account, region, and resolution. ` +
  'Treat this as an estimate, not a quote.';

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function estimateVideoCost(input: { readonly modelId: string; readonly durationSeconds: number }): CostEstimate {
  const rate = rateFor('video', input.modelId);
  if (rate.kind !== 'per-second') {
    return unpriced('video', input.modelId, rate);
  }
  // A zero or negative length would quote $0.00 for a job that still charges.
  const seconds = Math.max(1, Math.ceil(input.durationSeconds));
  return {
    kind: 'video',
    modelId: input.modelId,
    priced: true,
    amountUsd: round(seconds * rate.usd),
    basis: `${seconds}s × $${rate.usd.toFixed(2)}/s`,
    asOf: PRICING_AS_OF,
    caveat: LIST_PRICE_CAVEAT
  };
}

export function estimateImageCost(input: { readonly modelId: string; readonly imageCount: number }): CostEstimate {
  const rate = rateFor('image', input.modelId);
  if (rate.kind !== 'per-image') {
    return unpriced('image', input.modelId, rate);
  }
  const count = Math.max(1, Math.ceil(input.imageCount));
  return {
    kind: 'image',
    modelId: input.modelId,
    priced: true,
    amountUsd: round(count * rate.usd),
    basis: `${count} × $${rate.usd.toFixed(2)}/image`,
    asOf: PRICING_AS_OF,
    caveat: LIST_PRICE_CAVEAT
  };
}

export function estimateSpeechCost(input: { readonly modelId: string }): CostEstimate {
  return unpriced('speech', input.modelId, rateFor('speech', input.modelId));
}

function unpriced(kind: GenerationKind, modelId: string, rate: GenerationRate): CostEstimate {
  return {
    kind,
    modelId,
    priced: false,
    basis: '',
    asOf: PRICING_AS_OF,
    caveat:
      rate.kind === 'unknown'
        ? `${rate.reason} Ask the user to confirm they accept an unknown charge before generating.`
        : 'This model is billed on a basis OpenVideo cannot convert to a dollar figure.'
  };
}

/** A whole shot list, so a multi-shot scenario is priced as one decision. */
export function estimateVideoPlanCost(
  shots: readonly { readonly modelId: string; readonly durationSeconds: number }[]
): {
  readonly shots: readonly CostEstimate[];
  readonly totalUsd?: number;
  readonly fullyPriced: boolean;
  readonly asOf: string;
} {
  const estimates = shots.map((shot) => estimateVideoCost(shot));
  const fullyPriced = estimates.length > 0 && estimates.every((estimate) => estimate.priced);
  return {
    shots: estimates,
    // A partial total invites reading it as the whole bill, so it is withheld
    // entirely unless every shot priced.
    ...(fullyPriced ? { totalUsd: round(estimates.reduce((sum, e) => sum + (e.amountUsd ?? 0), 0)) } : {}),
    fullyPriced,
    asOf: PRICING_AS_OF
  };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  return estimate.priced && estimate.amountUsd !== undefined
    ? `~$${estimate.amountUsd.toFixed(2)} (${estimate.basis}). ${estimate.caveat}`
    : `Cost unknown for ${estimate.modelId}. ${estimate.caveat}`;
}
