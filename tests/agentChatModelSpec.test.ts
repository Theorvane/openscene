import { describe, expect, it } from 'vitest';

import { resolveAgentChatModelSpec } from '../src/main/agentChatModel';

describe('agent chat model provider resolution', () => {
  it('routes cloud catalog models to their provider client and credential slot', () => {
    expect(resolveAgentChatModelSpec('gpt-5')).toMatchObject({ kind: 'cloud', providerId: 'openai', credentialKey: 'openaiApiKey' });
    expect(resolveAgentChatModelSpec('gpt-5-mini')).toMatchObject({ kind: 'cloud', providerId: 'openai' });
    expect(resolveAgentChatModelSpec('claude-sonnet-5')).toMatchObject({ kind: 'cloud', providerId: 'anthropic', credentialKey: 'anthropicApiKey' });
    expect(resolveAgentChatModelSpec('gemini-3-pro')).toMatchObject({ kind: 'cloud', providerId: 'google_gemini', credentialKey: 'geminiApiKey' });
    expect(resolveAgentChatModelSpec('deepseek-v3.1')).toMatchObject({
      kind: 'cloud',
      providerId: 'deepseek',
      credentialKey: 'deepseekApiKey',
      openAiCompatibleBaseUrl: 'https://api.deepseek.com'
    });
  });

  it('keeps local catalog models and unknown custom models on the Ollama client', () => {
    expect(resolveAgentChatModelSpec('qwen2.5-coder')).toEqual({ kind: 'ollama' });
    expect(resolveAgentChatModelSpec('my-custom-local-model')).toEqual({ kind: 'ollama' });
  });
});
