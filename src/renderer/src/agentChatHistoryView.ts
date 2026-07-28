import type { AgentChatHistoryEntry } from '../../shared/agentChat';

export type AgentChatHistoryGroup = {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly AgentChatHistoryEntry[];
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayTitle(date: Date, now: Date): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / dayMs);
  if (dayDelta <= 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  const month = MONTH_LABELS[date.getMonth()] ?? '';
  return date.getFullYear() === now.getFullYear()
    ? `${month} ${date.getDate()}`
    : `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Group chat history rows by calendar day (Today / Yesterday / date), newest
 * first, for the home screen list. Entries whose timestamp cannot be parsed
 * are dropped rather than rendered under a bogus date.
 */
export function groupAgentChatHistory(
  entries: readonly AgentChatHistoryEntry[],
  now: Date
): readonly AgentChatHistoryGroup[] {
  const dated = entries
    .map((entry) => ({ entry, date: new Date(entry.updatedAt) }))
    .filter((item) => Number.isFinite(item.date.getTime()))
    .sort((left, right) => right.date.getTime() - left.date.getTime());

  const groups: { id: string; title: string; entries: AgentChatHistoryEntry[] }[] = [];
  for (const item of dated) {
    const id = `day-${startOfDay(item.date)}`;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.id === id) {
      lastGroup.entries.push(item.entry);
      continue;
    }
    groups.push({ id, title: dayTitle(item.date, now), entries: [item.entry] });
  }
  return groups;
}

/** Time-of-day label for a chat row; the group header already names the day. */
export function formatAgentChatTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
}
