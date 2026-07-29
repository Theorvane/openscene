import type { AppPageId } from './appPages';

/** Bounded page-history stack for the titlebar Back button. */
export const APP_NAVIGATION_HISTORY_LIMIT = 20;

export function pushPageHistory(history: readonly AppPageId[], leavingPageId: AppPageId): readonly AppPageId[] {
  const next = [...history, leavingPageId];
  return next.length > APP_NAVIGATION_HISTORY_LIMIT ? next.slice(next.length - APP_NAVIGATION_HISTORY_LIMIT) : next;
}

export function popPageHistory(history: readonly AppPageId[]): {
  readonly target: AppPageId | null;
  readonly rest: readonly AppPageId[];
} {
  const target = history[history.length - 1] ?? null;
  return { target, rest: history.slice(0, Math.max(0, history.length - 1)) };
}
