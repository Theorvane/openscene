import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { buildAgentChatGraph, type AgentChatModelFactory } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';
import type { OpenAiAuthMode } from '../src/shared/openAiAuth';

describe('Edit Agent OpenAI authentication mode', () => {
  it('threads explicit ChatGPT authentication from the send request into the graph model factory', async () => {
    // Given
    let receivedAuthMode: OpenAiAuthMode | undefined;
    const createModel: AgentChatModelFactory = (config) => {
      receivedAuthMode = config.openAiAuthMode;
      return { invoke: async () => new AIMessage('Ready.') };
    };
    const session = new AgentChatSessionManager(buildAgentChatGraph({
      tools: [],
      mutatingToolNames: new Set<string>(),
      createModel
    }));

    // When
    await session.sendMessage({
      conversationId: 'chatgpt-auth-conversation',
      text: 'Refactor this.',
      modelId: 'openai/gpt-5.3-codex',
      openAiAuthMode: 'chatgpt'
    });

    // Then
    expect(receivedAuthMode).toBe('chatgpt');
  });
});
