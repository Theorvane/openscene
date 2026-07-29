import { describe, expect, it } from 'vitest';

import { resolveAgentChatModelSpec } from '../src/main/agentChatModel';

describe('agent chat model provider resolution', () => {
  it('routes catalog cloud models to their provider adapter and credential slot', () => {
    expect(resolveAgentChatModelSpec('openai/gpt-5')).toMatchObject({
      kind: 'cloud',
      providerId: 'openai',
      adapter: 'openai-compatible',
      credentialKey: 'openaiApiKey',
      rawModelId: 'gpt-5',
      baseUrl: 'https://api.openai.com/v1'
    });
    expect(resolveAgentChatModelSpec('anthropic/claude-sonnet-5')).toMatchObject({
      kind: 'cloud',
      adapter: 'anthropic',
      credentialKey: 'anthropicApiKey',
      rawModelId: 'claude-sonnet-5'
    });
    // Codex-family OpenAI models are served by the Responses API.
    expect(resolveAgentChatModelSpec('openai/gpt-5.3-codex')).toMatchObject({
      kind: 'cloud',
      providerId: 'openai',
      useResponsesApi: true,
      rawModelId: 'gpt-5.3-codex'
    });
    expect(resolveAgentChatModelSpec('openai/gpt-5')).not.toHaveProperty('useResponsesApi');
    expect(resolveAgentChatModelSpec('deepseek/deepseek-chat')).toMatchObject({
      kind: 'cloud',
      adapter: 'openai-compatible',
      credentialKey: 'deepseekApiKey',
      rawModelId: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com'
    });
    // A provider that only exists in the generated catalog uses its own id as the credential slot.
    expect(resolveAgentChatModelSpec('openrouter/openai/gpt-4o')).toMatchObject({
      kind: 'cloud',
      providerId: 'openrouter',
      adapter: 'openai-compatible',
      credentialKey: 'openrouter',
      rawModelId: 'openai/gpt-4o'
    });
  });

  it('keeps local catalog models and unknown custom models on the Ollama client', () => {
    expect(resolveAgentChatModelSpec('qwen2.5-coder')).toEqual({ kind: 'ollama' });
    expect(resolveAgentChatModelSpec('my-custom-local-model')).toEqual({ kind: 'ollama' });
  });
});
