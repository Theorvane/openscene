import { describe, expect, it } from 'vitest';

import {
  buildContextUsage,
  contextUsagePercent,
  formatContextUsage,
  formatTokenCount,
  parseContextWindowTokens,
  turnUsedTokens,
  contextPressure,
  needsCompaction,
  usableContextTokens
} from '../src/shared/agentChatUsage';

describe('Edit Agent context usage', () => {
  it('prefers the provider total and falls back to input plus output', () => {
    expect(turnUsedTokens({ totalTokens: 4_200, inputTokens: 4_000, outputTokens: 200 })).toBe(4_200);
    expect(turnUsedTokens({ inputTokens: 4_000, outputTokens: 200 })).toBe(4_200);
    // Missing or nonsense numbers count as nothing rather than NaN.
    expect(turnUsedTokens({ inputTokens: Number.NaN, outputTokens: -5 })).toBe(0);
    expect(turnUsedTokens(undefined)).toBe(0);
  });

  it('reads the catalog context window, which is a display string', () => {
    expect(parseContextWindowTokens('200k')).toBe(200_000);
    expect(parseContextWindowTokens('1M')).toBe(1_000_000);
    expect(parseContextWindowTokens('1.5k')).toBe(1_500);
    expect(parseContextWindowTokens('8192')).toBe(8_192);
    expect(parseContextWindowTokens(undefined)).toBeUndefined();
    expect(parseContextWindowTokens('unknown')).toBeUndefined();
  });

  it('omits usage entirely when a turn reported none, so the meter stays hidden', () => {
    expect(buildContextUsage(undefined, '200k')).toBeUndefined();
    expect(buildContextUsage({ inputTokens: 0, outputTokens: 0 }, '200k')).toBeUndefined();
  });

  it('reports a percentage only for models that publish a window', () => {
    const withLimit = buildContextUsage({ totalTokens: 20_000 }, '200k');
    expect(withLimit).toEqual({ usedTokens: 20_000, limitTokens: 200_000 });
    expect(contextUsagePercent(withLimit)).toBe(10);

    const withoutLimit = buildContextUsage({ totalTokens: 20_000 }, undefined);
    expect(withoutLimit).toEqual({ usedTokens: 20_000 });
    expect(contextUsagePercent(withoutLimit)).toBeNull();
    // A conversation past the published window still reads as full, not 130%.
    expect(contextUsagePercent({ usedTokens: 260_000, limitTokens: 200_000 })).toBe(100);
  });

  it('formats counts compactly enough for a dense meter', () => {
    expect(formatTokenCount(938)).toBe('938');
    expect(formatTokenCount(12_400)).toBe('12.4k');
    expect(formatTokenCount(200_000)).toBe('200k');
    expect(formatTokenCount(1_240_000)).toBe('1.2M');
    expect(formatContextUsage({ usedTokens: 12_400, limitTokens: 200_000 })).toBe('12.4k / 200k');
    expect(formatContextUsage({ usedTokens: 12_400 })).toBe('12.4k tokens');
    expect(formatContextUsage(undefined)).toBeNull();
  });
});

describe('Edit Agent context compaction rules', () => {
  it('reserves room for the next reply instead of filling the window', () => {
    expect(usableContextTokens(200_000)).toBe(180_000);
    expect(usableContextTokens(undefined)).toBeUndefined();
    // A window smaller than the reserve still leaves half of it usable.
    expect(usableContextTokens(8_000)).toBe(4_000);
  });

  it('warns before the window is full and calls for compaction once it is', () => {
    const at = (usedTokens: number) => ({ usedTokens, limitTokens: 200_000 });

    expect(contextPressure(at(10_000))).toBe('ok');
    expect(contextPressure(at(150_000))).toBe('warning');
    expect(contextPressure(at(180_000))).toBe('overflow');
    expect(needsCompaction(at(180_000))).toBe(true);
    expect(needsCompaction(at(150_000))).toBe(false);
  });

  it('never demands compaction for a model with no published window', () => {
    // Without a limit there is nothing to overflow, so the agent is left alone.
    expect(contextPressure({ usedTokens: 900_000 })).toBe('ok');
    expect(needsCompaction({ usedTokens: 900_000 })).toBe(false);
    expect(contextPressure(undefined)).toBe('ok');
  });
});
