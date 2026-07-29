import { describe, expect, it } from 'vitest';

import { resolveAgentChatModelSpec, resolveChatGptCodexClientConfig } from '../src/main/agentChatModel';

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

  it('resolves explicit ChatGPT authentication to a private Responses API Codex client spec', () => {
    // Given
    const modelId = 'openai/gpt-5.3-codex';

    // When
    const spec = resolveAgentChatModelSpec(modelId, 'chatgpt');

    // Then
    expect(spec).toEqual({
      kind: 'chatgpt-codex',
      providerId: 'openai',
      providerLabel: 'OpenAI',
      rawModelId: 'gpt-5.3-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accountIdHeader: 'ChatGPT-Account-Id',
      useResponsesApi: true
    });
  });

  it('builds the ChatOpenAI client configuration with OAuth bearer and account headers', () => {
    // Given
    const spec = resolveAgentChatModelSpec('openai/gpt-5.3-codex', 'chatgpt');
    if (spec.kind !== 'chatgpt-codex') {
      throw new Error('Expected a ChatGPT Codex model spec.');
    }

    // When
    const config = resolveChatGptCodexClientConfig(spec, {
      accessToken: 'oauth-access-token',
      accountId: 'account-123'
    });

    // Then
    expect(config).toEqual({
      model: 'gpt-5.3-codex',
      apiKey: 'oauth-access-token',
      useResponsesApi: true,
      configuration: {
        baseURL: 'https://chatgpt.com/backend-api/codex',
        defaultHeaders: {
          Authorization: 'Bearer oauth-access-token',
          'ChatGPT-Account-Id': 'account-123'
        }
      }
    });
  });

  it('rejects a regular OpenAI model when Edit Agent explicitly uses ChatGPT authentication', () => {
    // Given
    const resolve = (): void => {
      resolveAgentChatModelSpec('openai/gpt-5', 'chatgpt');
    };

    // When / Then
    expect(resolve).toThrow('not a Codex-family model');
  });

  it('rejects a non-OpenAI model when Edit Agent explicitly uses ChatGPT authentication', () => {
    // Given
    const resolve = (): void => {
      resolveAgentChatModelSpec('anthropic/claude-sonnet-5', 'chatgpt');
    };

    // When / Then
    expect(resolve).toThrow('only canonical OpenAI Codex-family models');
  });
});
