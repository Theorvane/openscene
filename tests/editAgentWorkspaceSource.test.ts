import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const AGENT_CONTEXT_URL = new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url);
const AGENT_PANEL_URL = new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url);

describe('Edit Agent workspace wiring', () => {
  it('renders the self-contained Edit Agent panel with model, context, conversation, approval, reset, and prompt regions', async () => {
    const [context, panel] = await Promise.all([
      readFile(AGENT_CONTEXT_URL, 'utf8'),
      readFile(AGENT_PANEL_URL, 'utf8')
    ]);

    expect(context).toContain("getSelectedDomainModel('edit-agent')");
    expect(context).toContain('messages');
    expect(context).toContain('pendingApproval');
    expect(context).toContain('resetConversation');
    expect(context).toContain('contextAssets');
    expect(context).toContain('attachContextAsset');
    expect(panel).toContain('selectedModel.label');
    expect(panel).toContain('AiDomainModelSelector domain="edit-agent"');
    expect(panel).toContain('agent-chat-log');
    expect(panel).toContain('messages.map((message) => (');
    expect(panel).toContain("message.role === 'tool' ? `Tool · ${message.toolName}` : message.role");
    expect(panel).toContain('agent-chat-approval');
    expect(panel).toContain('Reset conversation');
    expect(panel).toContain('Tell OpenVideo what to do…');
    expect(panel).toContain('Respond to the approval above first...');
    expect(panel).toContain('agent-chat-panel__form');
    expect(panel).not.toContain('EditAgentWorkspace');
    expect(panel).not.toContain('AgentChatToggle');
    expect(panel).not.toContain('LlmAssistantCopilot');
  });
});
