import { describe, expect, it } from 'vitest';

import { getDomainModels } from '../src/shared/aiDomainModels';
import {
  PRICING_AS_OF,
  estimateImageCost,
  estimateSpeechCost,
  estimateVideoCost,
  estimateVideoPlanCost,
  formatCostEstimate,
  rateFor
} from '../src/shared/mediaGenerationPricing';

describe('video cost estimates', () => {
  it('multiplies the recorded per-second rate by the requested length', () => {
    // Given / When
    const estimate = estimateVideoCost({ modelId: 'veo-3.0-generate-001', durationSeconds: 8 });

    // Then
    expect(estimate.priced).toBe(true);
    expect(estimate.amountUsd).toBe(3.2);
    expect(estimate.basis).toBe('8s × $0.40/s');
    expect(estimate.asOf).toBe(PRICING_AS_OF);
  });

  it('never quotes zero for a job that would still be charged', () => {
    // Given / When / Then
    // A 0s or negative request is a bug upstream; quoting $0.00 would turn it
    // into an approved charge of an unknown amount.
    expect(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 0 }).amountUsd).toBe(0.1);
    expect(estimateVideoCost({ modelId: 'sora-2', durationSeconds: -5 }).amountUsd).toBe(0.1);
  });

  it('rounds a partial second up, because providers bill the whole one', () => {
    // Given / When / Then
    expect(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 4.2 }).amountUsd).toBe(0.5);
  });

  it('reports a model with no recorded rate as unpriced instead of guessing', () => {
    // Given / When
    const estimate = estimateVideoCost({ modelId: 'kling-v2.5-turbo', durationSeconds: 5 });

    // Then
    expect(estimate.priced).toBe(false);
    expect(estimate.amountUsd).toBeUndefined();
    // The agent has to turn this into a question, not a number.
    expect(estimate.caveat).toMatch(/confirm they accept an unknown charge/);
  });

  it('always says the figure is a dated list price rather than a quote', () => {
    // Given / When / Then
    const estimate = estimateVideoCost({ modelId: 'veo-3.0-fast-generate-001', durationSeconds: 6 });
    expect(estimate.caveat).toContain(PRICING_AS_OF);
    expect(estimate.caveat).toMatch(/estimate, not a quote/);
  });
});

describe('image and speech cost estimates', () => {
  it('prices images per image', () => {
    expect(estimateImageCost({ modelId: 'imagen-4.0-ultra-generate-001', imageCount: 3 }).amountUsd).toBe(0.18);
    expect(estimateImageCost({ modelId: 'gpt-image-1', imageCount: 1 }).basis).toBe('1 × $0.04/image');
  });

  it('leaves Seedream unpriced rather than inventing a rate', () => {
    expect(estimateImageCost({ modelId: 'seedream-4-0-250828', imageCount: 1 }).priced).toBe(false);
  });

  it('refuses to convert credit-billed speech into dollars', () => {
    // ElevenLabs bills against a monthly credit allowance, so any per-character
    // dollar figure would be fiction dressed as arithmetic.
    const estimate = estimateSpeechCost({ modelId: 'eleven_v3' });
    expect(estimate.priced).toBe(false);
    expect(estimate.amountUsd).toBeUndefined();
  });
});

describe('whole-plan estimates', () => {
  it('totals a shot list so a scenario is one spending decision', () => {
    // Given / When
    const plan = estimateVideoPlanCost([
      { modelId: 'sora-2', durationSeconds: 8 },
      { modelId: 'sora-2', durationSeconds: 4 },
      { modelId: 'veo-3.0-fast-generate-001', durationSeconds: 6 }
    ]);

    // Then
    expect(plan.fullyPriced).toBe(true);
    expect(plan.totalUsd).toBe(2.1);
    expect(plan.shots).toHaveLength(3);
  });

  it('withholds the total when any shot is unpriced', () => {
    // Given / When
    const plan = estimateVideoPlanCost([
      { modelId: 'sora-2', durationSeconds: 8 },
      { modelId: 'kling-v2.5-turbo', durationSeconds: 5 }
    ]);

    // Then
    // A total covering only the priced shots reads as the whole bill.
    expect(plan.fullyPriced).toBe(false);
    expect(plan.totalUsd).toBeUndefined();
  });

  it('treats an empty plan as not priced rather than free', () => {
    const plan = estimateVideoPlanCost([]);
    expect(plan.fullyPriced).toBe(false);
    expect(plan.totalUsd).toBeUndefined();
  });
});

describe('pricing table coverage', () => {
  it('has a rate or an explicit unknown for every selectable video and image model', () => {
    // Given / When / Then
    // rateFor must answer for anything the picker can offer; a missing entry
    // that threw would break the estimate instead of reporting uncertainty.
    for (const kind of ['video', 'image'] as const) {
      const domain = kind === 'video' ? 'video-generation' : 'image-generation';
      for (const model of getDomainModels(domain)) {
        const rate = rateFor(kind, model.id);
        expect(['per-second', 'per-image', 'unknown'], `${model.id}`).toContain(rate.kind);
      }
    }
  });

  it('formats both a priced and an unpriced estimate as a readable sentence', () => {
    expect(formatCostEstimate(estimateVideoCost({ modelId: 'sora-2', durationSeconds: 8 }))).toMatch(
      /^~\$0\.80 \(8s × \$0\.10\/s\)\./
    );
    expect(formatCostEstimate(estimateVideoCost({ modelId: 'ray-2', durationSeconds: 8 }))).toMatch(
      /^Cost unknown for ray-2\./
    );
  });
});
