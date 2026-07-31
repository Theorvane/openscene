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
    expect(context).toContain('activeProject');
    expect(context).toContain('sendMessage');
    expect(panel).toContain('selectedModel.label');
    expect(panel).toContain('<AgentModelPicker reasoningEffort={reasoningEffort} onReasoningEffortChange={setReasoningEffort} />');
    expect(panel).toContain('<AgentChatSessionPicker />');
    expect(context).toContain('startNewSession');
    expect(context).toContain('switchSession');
    expect(panel).toContain('agent-chat-log');
    expect(panel).toContain('messages.map((message) => (');
    // Rendering lives in AgentChatMessageView: markdown for turns, a collapsed
    // status row for tool payloads.
    expect(panel).toContain('<AgentChatMessageView key={message.id} message={message} />');
    expect(panel).toContain('agent-chat-approval');
    expect(panel).toContain('Reset conversation');
    expect(panel).toContain('Tell OpenScene what to do…');
    expect(panel).toContain('Respond to the approval above first...');
    expect(panel).toContain('agent-chat-panel__form');
    expect(panel).not.toContain('EditAgentWorkspace');
    expect(panel).not.toContain('AgentChatToggle');
    expect(panel).not.toContain('LlmAssistantCopilot');
  });
});
