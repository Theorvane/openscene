import { describe, expect, it } from 'vitest';

import { isOpenAiAuthMode, isOpenAiCodexModelKey, resolveOpenAiAuthMode } from '../src/shared/openAiAuth';

describe('unified OpenAI auth mode selection', () => {
  it('recognises only canonical OpenAI Codex-family model keys', () => {
    expect(isOpenAiCodexModelKey('openai/gpt-5.3-codex')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5-codex')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5')).toBe(false);
    // Codex models re-listed by aggregators are not ChatGPT-eligible.
    expect(isOpenAiCodexModelKey('openrouter/openai/gpt-5.3-codex')).toBe(false);
    expect(isOpenAiCodexModelKey('qwen2.5-coder')).toBe(false);
    expect(isOpenAiCodexModelKey('')).toBe(false);
  });

  it('uses ChatGPT only for Codex models while a sign-in is connected', () => {
    expect(resolveOpenAiAuthMode('openai/gpt-5.3-codex', true)).toBe('chatgpt');
    // Without a sign-in the same model falls back to the API key.
    expect(resolveOpenAiAuthMode('openai/gpt-5.3-codex', false)).toBe('api-key');
    // Non-Codex OpenAI models always use the API key, matching the main-process
    // rule that rejects them in chatgpt mode.
    expect(resolveOpenAiAuthMode('openai/gpt-5', true)).toBe('api-key');
    expect(resolveOpenAiAuthMode('anthropic/claude-sonnet-5', true)).toBe('api-key');
    expect(resolveOpenAiAuthMode('qwen2.5-coder', true)).toBe('api-key');
  });

  it('validates the transported auth mode values', () => {
    expect(isOpenAiAuthMode('chatgpt')).toBe(true);
    expect(isOpenAiAuthMode('api-key')).toBe(true);
    expect(isOpenAiAuthMode('oauth')).toBe(false);
    expect(isOpenAiAuthMode(undefined)).toBe(false);
  });
});
