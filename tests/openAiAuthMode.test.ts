import { describe, expect, it } from 'vitest';

import { isOpenAiAuthMode, isOpenAiCodexModelKey, resolveOpenAiAuthMode } from '../src/shared/openAiAuth';

describe('unified OpenAI auth mode selection', () => {
  it('recognises only the models the ChatGPT backend actually serves', () => {
    // Explicitly allowed ids.
    expect(isOpenAiCodexModelKey('openai/gpt-5.3-codex-spark')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.4')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.4-mini')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.5')).toBe(true);
    // Newer than 5.4 passes the version rule, including the whole 5.6 family.
    expect(isOpenAiCodexModelKey('openai/gpt-5.6')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.6-luna')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.6-sol')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.6-terra')).toBe(true);
    // The version is compared as [major, minor], so a two-digit minor sorts
    // correctly instead of parsing as 5.1 and reading as older than 5.4.
    expect(isOpenAiCodexModelKey('openai/gpt-5.10')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-6.0')).toBe(true);
    expect(isOpenAiCodexModelKey('openai/gpt-5.04')).toBe(false);

    // Older Codex builds and Pro tiers are rejected by the backend with a bare
    // 400, so they must never route through the sign-in.
    expect(isOpenAiCodexModelKey('openai/gpt-5.3-codex')).toBe(false);
    expect(isOpenAiCodexModelKey('openai/gpt-5.5-pro')).toBe(false);
    expect(isOpenAiCodexModelKey('openai/gpt-5.6-pro')).toBe(false);
    expect(isOpenAiCodexModelKey('openai/gpt-5')).toBe(false);
    // Models re-listed by aggregators are not ChatGPT-eligible.
    expect(isOpenAiCodexModelKey('openrouter/openai/gpt-5.4')).toBe(false);
    expect(isOpenAiCodexModelKey('qwen2.5-coder')).toBe(false);
    expect(isOpenAiCodexModelKey('')).toBe(false);
  });

  it('uses ChatGPT only for served models while a sign-in is connected', () => {
    expect(resolveOpenAiAuthMode('openai/gpt-5.3-codex-spark', true)).toBe('chatgpt');
    // Without a sign-in the same model falls back to the API key.
    expect(resolveOpenAiAuthMode('openai/gpt-5.3-codex-spark', false)).toBe('api-key');
    // Unserved OpenAI models always use the API key, matching the main-process
    // rule that rejects them in chatgpt mode.
    expect(resolveOpenAiAuthMode('openai/gpt-5.3-codex', true)).toBe('api-key');
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
