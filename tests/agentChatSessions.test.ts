import { describe, expect, it } from 'vitest';

import { activeAgentChatSessionTitle, buildAgentChatSessionRows, NEW_SESSION_TITLE } from '../src/renderer/src/agentChatSessions';
import type { AgentChatHistoryEntry } from '../src/shared/agentChat';

const entry = (overrides: Partial<AgentChatHistoryEntry>): AgentChatHistoryEntry => ({
  projectId: 'p1',
  projectName: 'Project One',
  conversationId: 'c1',
  title: 'Trim the intro',
  updatedAt: '2026-07-29T10:00:00.000Z',
  messageCount: 4,
  ...overrides
});

describe('Edit Agent chat sessions', () => {
  it('lists this project sessions newest first and marks the open one', () => {
    const rows = buildAgentChatSessionRows({
      entries: [
        entry({ conversationId: 'old', updatedAt: '2026-07-28T09:00:00.000Z', title: 'Older work' }),
        entry({ conversationId: 'new', updatedAt: '2026-07-29T18:00:00.000Z', title: 'Newer work' }),
        entry({ conversationId: 'other', projectId: 'p2', title: 'Another project' })
      ],
      projectId: 'p1',
      activeConversationId: 'old'
    });

    expect(rows.map((row) => row.conversationId)).toEqual(['new', 'old']);
    expect(rows.find((row) => row.isActive)?.conversationId).toBe('old');
    expect(activeAgentChatSessionTitle(rows)).toBe('Older work');
  });

  it('lists the open session before its first turn is recorded', () => {
    const rows = buildAgentChatSessionRows({
      entries: [entry({ conversationId: 'saved' })],
      projectId: 'p1',
      activeConversationId: 'brand-new'
    });

    // Otherwise the switcher would show no entry for the conversation on screen.
    expect(rows[0]).toMatchObject({ conversationId: 'brand-new', title: NEW_SESSION_TITLE, isActive: true, updatedAt: '' });
    expect(rows).toHaveLength(2);
    expect(activeAgentChatSessionTitle(rows)).toBe(NEW_SESSION_TITLE);
  });

  it('keeps only the open session when no project is open', () => {
    const rows = buildAgentChatSessionRows({
      entries: [entry({})],
      projectId: null,
      activeConversationId: 'scratch'
    });

    expect(rows).toEqual([
      { conversationId: 'scratch', title: NEW_SESSION_TITLE, updatedAt: '', messageCount: 0, isActive: true }
    ]);
  });
});
