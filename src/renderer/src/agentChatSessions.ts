import type { AgentChatHistoryEntry } from '../../shared/agentChat';

/**
 * Session list rules for the chat panel. Conversations are already persisted
 * per project in chats.json; these turn that history into the switcher rows,
 * including the session currently open, which has no history row until its
 * first turn is recorded.
 */

export const NEW_SESSION_TITLE = 'New session';

export type AgentChatSessionRow = {
  readonly conversationId: string;
  readonly title: string;
  /** ISO timestamp, or '' for a session with nothing recorded yet. */
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly isActive: boolean;
};

export type AgentChatSessionRowsInput = {
  readonly entries: readonly AgentChatHistoryEntry[];
  /** Sessions are scoped to a project; null means no project is open. */
  readonly projectId: string | null;
  readonly activeConversationId: string;
};

export function buildAgentChatSessionRows({
  entries,
  projectId,
  activeConversationId
}: AgentChatSessionRowsInput): readonly AgentChatSessionRow[] {
  const rows: AgentChatSessionRow[] =
    projectId === null
      ? []
      : entries
          .filter((entry) => entry.projectId === projectId)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((entry) => ({
            conversationId: entry.conversationId,
            title: entry.title,
            updatedAt: entry.updatedAt,
            messageCount: entry.messageCount,
            isActive: entry.conversationId === activeConversationId
          }));

  // The open session is listed even before its first turn is recorded, so the
  // switcher never looks like the conversation on screen does not exist.
  if (rows.some((row) => row.isActive)) return rows;
  return [
    { conversationId: activeConversationId, title: NEW_SESSION_TITLE, updatedAt: '', messageCount: 0, isActive: true },
    ...rows
  ];
}

/** Label for the switcher trigger: the open session's title. */
export function activeAgentChatSessionTitle(rows: readonly AgentChatSessionRow[]): string {
  return rows.find((row) => row.isActive)?.title ?? NEW_SESSION_TITLE;
}
