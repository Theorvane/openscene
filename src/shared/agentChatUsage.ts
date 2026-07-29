import type { AgentChatContextUsage } from './agentChat';

/**
 * Context-window accounting for the chat panel.
 *
 * A turn reports usage the way the provider does — prompt tokens already
 * include the whole conversation the model was sent, so the newest reported
 * total is the conversation's context size, not a running sum.
 */

export interface TurnTokenUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

function finitePositive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Tokens a turn put in front of the model: the provider's own total when it
 * reports one, otherwise input plus output.
 */
export function turnUsedTokens(usage: TurnTokenUsage | undefined): number {
  if (usage === undefined) return 0;
  const total = finitePositive(usage.totalTokens);
  if (total > 0) return total;
  return finitePositive(usage.inputTokens) + finitePositive(usage.outputTokens);
}

/**
 * Parses a catalog context window such as `200k` into tokens. The catalog
 * stores it as a display string, and models without one simply have no limit
 * to show.
 */
export function parseContextWindowTokens(contextWindow: string | undefined): number | undefined {
  if (contextWindow === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(contextWindow.trim());
  if (match === null) return undefined;
  const value = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const scale = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(value * scale);
}

export function buildContextUsage(usage: TurnTokenUsage | undefined, contextWindow: string | undefined): AgentChatContextUsage | undefined {
  const usedTokens = turnUsedTokens(usage);
  if (usedTokens <= 0) return undefined;
  const limitTokens = parseContextWindowTokens(contextWindow);
  return limitTokens === undefined ? { usedTokens } : { usedTokens, limitTokens };
}

/** Whole-percent share of the window, or null when the model publishes none. */
export function contextUsagePercent(usage: AgentChatContextUsage | undefined): number | null {
  if (usage === undefined || usage.limitTokens === undefined || usage.limitTokens <= 0) return null;
  return Math.min(100, Math.round((usage.usedTokens / usage.limitTokens) * 100));
}

/** Compact token count for a dense meter: `938`, `12.4k`, `1.2M`. */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return `${Math.max(0, Math.round(tokens))}`;
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000;
    // One decimal until the number is wide enough to crowd the meter.
    return `${thousands < 100 ? thousands.toFixed(1) : Math.round(thousands)}k`;
  }
  const millions = tokens / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}M`;
}

export function formatContextUsage(usage: AgentChatContextUsage | undefined): string | null {
  if (usage === undefined) return null;
  const used = formatTokenCount(usage.usedTokens);
  if (usage.limitTokens === undefined) return `${used} tokens`;
  return `${used} / ${formatTokenCount(usage.limitTokens)}`;
}

/**
 * Compaction budget, following opencode's overflow rule: a conversation may
 * fill the window minus a reserve kept free for the next reply. Crossing that
 * line means the next turn would not fit, so the history has to be summarized
 * before it is sent again.
 */
export const CONTEXT_RESERVE_TOKENS = 20_000;

/** Recent tail kept verbatim after a compaction, ahead of the summary. */
export const CONTEXT_KEEP_RECENT_TURNS = 6;

export type ContextPressure = 'ok' | 'warning' | 'overflow';

export function usableContextTokens(limitTokens: number | undefined): number | undefined {
  if (limitTokens === undefined || limitTokens <= 0) return undefined;
  // Never reserve so much that nothing is usable on a small window.
  return Math.max(Math.round(limitTokens / 2), limitTokens - CONTEXT_RESERVE_TOKENS);
}

/**
 * `overflow` means the next turn no longer fits and the conversation must be
 * compacted; `warning` is the last stretch before that, so the panel can say so
 * before the agent is interrupted mid-task.
 */
export function contextPressure(usage: AgentChatContextUsage | undefined): ContextPressure {
  const usable = usableContextTokens(usage?.limitTokens);
  if (usage === undefined || usable === undefined) return 'ok';
  if (usage.usedTokens >= usable) return 'overflow';
  return usage.usedTokens >= usable * 0.8 ? 'warning' : 'ok';
}

/** True when a conversation should be compacted before the next send. */
export function needsCompaction(usage: AgentChatContextUsage | undefined): boolean {
  return contextPressure(usage) === 'overflow';
}
