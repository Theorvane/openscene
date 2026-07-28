import { describe, expect, it } from 'vitest';

import { formatAgentChatTime, groupAgentChatHistory } from '../src/renderer/src/agentChatHistoryView';
import type { AgentChatHistoryEntry } from '../src/shared/agentChat';

function entry(overrides: Partial<AgentChatHistoryEntry>): AgentChatHistoryEntry {
  return {
    projectId: 'project-1',
    projectName: 'Reel',
    conversationId: 'conv-1',
    title: 'Chat',
    updatedAt: '2026-07-29T10:00:00.000Z',
    messageCount: 2,
    ...overrides
  };
}

const NOW = new Date(2026, 6, 29, 15, 0, 0);

describe('agent chat history view', () => {
  it('groups chats by calendar day with Today and Yesterday titles, newest first', () => {
    const groups = groupAgentChatHistory(
      [
        entry({ conversationId: 'old', updatedAt: new Date(2026, 6, 12, 9, 0).toISOString() }),
        entry({ conversationId: 'today-early', updatedAt: new Date(2026, 6, 29, 8, 0).toISOString() }),
        entry({ conversationId: 'yesterday', updatedAt: new Date(2026, 6, 28, 22, 0).toISOString() }),
        entry({ conversationId: 'today-late', updatedAt: new Date(2026, 6, 29, 14, 0).toISOString() })
      ],
      NOW
    );

    expect(groups.map((group) => group.title)).toEqual(['Today', 'Yesterday', 'Jul 12']);
    expect(groups[0]?.entries.map((item) => item.conversationId)).toEqual(['today-late', 'today-early']);
  });

  it('labels chats from another year with that year and drops unparsable timestamps', () => {
    const groups = groupAgentChatHistory(
      [
        entry({ conversationId: 'last-year', updatedAt: new Date(2025, 11, 31, 10, 0).toISOString() }),
        entry({ conversationId: 'broken', updatedAt: 'not-a-date' })
      ],
      NOW
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Dec 31, 2025');
    expect(groups[0]?.entries.map((item) => item.conversationId)).toEqual(['last-year']);
  });

  it('formats row times as time of day and hides invalid ones', () => {
    expect(formatAgentChatTime(new Date(2026, 6, 29, 9, 5).toISOString())).toBe('9:05');
    expect(formatAgentChatTime('nope')).toBe('');
  });
});
