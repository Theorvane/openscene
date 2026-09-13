import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_MODELS,
  LLM_STORAGE_CONFIG_KEY,
  LLM_STORAGE_MODEL_KEY,
  getLlmModel,
  parseLlmModelKey,
  parseSelectedLlmModelId
} from '../src/shared/llmModels';
import { LLM_CATALOG } from '../src/shared/llmCatalog.generated';
import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmProvider, isProviderConnected } from '../src/shared/llmProviders';

describe('LLM provider and model catalog configuration', () => {
  it('imports the full models.dev catalog with unique canonical model keys', () => {
    expect(LLM_CATALOG.length).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_LLM_MODELS.length).toBeGreaterThanOrEqual(3000);

    const ids = DEFAULT_LLM_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('qwen2.5-coder');
    expect(ids).toContain('openai/gpt-5');
    expect(ids).toContain('anthropic/claude-sonnet-5');
    expect(ids).toContain('deepseek/deepseek-chat');
    expect(ids).toContain('openrouter/openai/gpt-4o');
    expect(ids).toContain('agentrouter/claude-opus-4-8');
    expect(ids).toContain('agentrouter/gpt-5.6-sol');

    for (const model of DEFAULT_LLM_MODELS.slice(0, 200)) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.providerLabel.length).toBeGreaterThan(0);
      expect(['LOCAL', 'FAST', 'SMART', 'REASONING']).toContain(model.badge);
      expect(['local', 'api']).toContain(model.defaultMode);
    }
  });

  it('links every model to a registered provider with a working adapter', () => {
    for (const model of DEFAULT_LLM_MODELS) {
      const provider = getLlmProvider(model.providerId);
      expect(provider).toBeDefined();
      expect(model.available).toBe(true);
      if (provider!.kind === 'cloud') {
        expect(provider!.credentialKey).toBeDefined();
        expect(['openai-compatible', 'anthropic', 'gemini']).toContain(provider!.adapter);
        if (provider!.adapter === 'openai-compatible') {
          expect(provider!.baseUrl).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it('keeps every provider id unique so no registry entry shadows another', () => {
    // A media provider sharing an id with a catalog provider used to hide the
    // catalog's chat models behind the media adapter.
    const ids = LLM_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('registers connection semantics: local always on, cloud gated on its credential slot', () => {
    expect(LLM_PROVIDERS[0]?.id).toBe('local_ollama');
    expect(isProviderConnected('local_ollama', {})).toBe(true);

    for (const popularId of POPULAR_LLM_PROVIDER_IDS) {
      const provider = getLlmProvider(popularId);
      expect(provider).toBeDefined();
      expect(isProviderConnected(popularId, {})).toBe(false);
      expect(isProviderConnected(popularId, { [provider!.credentialKey!]: true })).toBe(true);
    }
    // Legacy credential slots stay stable for the original four providers.
    expect(getLlmProvider('openai')?.credentialKey).toBe('openaiApiKey');
    expect(getLlmProvider('anthropic')?.credentialKey).toBe('anthropicApiKey');
    expect(getLlmProvider('google_gemini')?.credentialKey).toBe('geminiApiKey');
    expect(getLlmProvider('deepseek')?.credentialKey).toBe('deepseekApiKey');
    expect(getLlmProvider('agentrouter')).toMatchObject({
      credentialKey: 'agentRouterApiKey',
      baseUrl: 'https://agentrouter.org/v1',
      adapter: 'openai-compatible'
    });
    expect(isProviderConnected('unknown-provider', { anyKey: true })).toBe(false);

    const openAiProviders = LLM_PROVIDERS.filter((provider) => provider.id === 'openai');
    expect(openAiProviders).toHaveLength(1);
    expect(openAiProviders[0]?.auth).toBe('api-key');
    expect(isProviderConnected('openai', { openaiApiKey: true })).toBe(true);
    expect(getLlmProvider('openai-codex')).toBeUndefined();
  });

  it('parses canonical provider/model keys and keeps resolvable stored selections', () => {
    expect(parseLlmModelKey('openai/gpt-5')).toEqual({ providerId: 'openai', modelId: 'gpt-5' });
    expect(parseLlmModelKey('openrouter/openai/gpt-4o')).toEqual({ providerId: 'openrouter', modelId: 'openai/gpt-4o' });
    expect(parseLlmModelKey('qwen2.5-coder')).toBeNull();

    expect(parseSelectedLlmModelId('qwen2.5-coder')).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('openai/gpt-5')).toBe('openai/gpt-5');
    expect(parseSelectedLlmModelId('anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');

    // Null/undefined/unknown (including pre-catalog bare cloud ids) fall back to the local default.
    expect(parseSelectedLlmModelId(null)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId(undefined)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('gpt-5')).toBe('qwen2.5-coder');
    expect(getLlmModel('invalid-model-id')).toBeUndefined();
  });

  it('uses openvideo storage key constants for LLM model and provider config', () => {
    expect(LLM_STORAGE_MODEL_KEY).toBe('openvideo-selected-llm-model');
    expect(LLM_STORAGE_CONFIG_KEY).toBe('openvideo-llm-provider-config');
  });
});
