import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_MODELS,
  LLM_STORAGE_CONFIG_KEY,
  LLM_STORAGE_MODEL_KEY,
  getLlmModel,
  parseSelectedLlmModelId
} from '../src/shared/llmModels';
import { LLM_PROVIDERS, getLlmProvider, isProviderConnected } from '../src/shared/llmProviders';

describe('LLM provider and model catalog configuration', () => {
  it('defines valid LLM models with provider labels, categories, and badges', () => {
    expect(DEFAULT_LLM_MODELS.length).toBeGreaterThanOrEqual(8);

    const modelIds = DEFAULT_LLM_MODELS.map((m) => m.id);
    expect(modelIds).toContain('qwen2.5-coder');
    expect(modelIds).toContain('gpt-5');
    expect(modelIds).toContain('claude-opus-4-8');
    expect(modelIds).toContain('claude-sonnet-5');
    expect(modelIds).toContain('gemini-3-pro');
    expect(modelIds).toContain('deepseek-v3.1');
    expect(modelIds).toContain('deepseek-r1');

    for (const model of DEFAULT_LLM_MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.providerLabel.length).toBeGreaterThan(0);
      expect(model.description.length).toBeGreaterThan(0);
      expect(['LOCAL', 'FAST', 'SMART', 'REASONING']).toContain(model.badge);
      expect(['local', 'api']).toContain(model.defaultMode);
    }
  });

  it('links every model to a registered provider whose adapter is implemented', () => {
    for (const model of DEFAULT_LLM_MODELS) {
      const provider = getLlmProvider(model.providerId);
      expect(provider).toBeDefined();
      // Every catalog provider has a real main-process adapter now, so every
      // model is available; cloud models still gate on connection at runtime.
      expect(model.available).toBe(true);
      expect(model.defaultMode).toBe(provider!.kind === 'local' ? 'local' : 'api');
    }
  });

  it('registers the opencode-style provider set with connection semantics', () => {
    expect(LLM_PROVIDERS.map((provider) => provider.id)).toEqual([
      'local_ollama',
      'openai',
      'anthropic',
      'google_gemini',
      'deepseek'
    ]);

    for (const provider of LLM_PROVIDERS) {
      if (provider.kind === 'local') {
        expect(provider.auth).toBe('none');
        expect(isProviderConnected(provider.id, {})).toBe(true);
      } else {
        expect(provider.auth).toBe('api-key');
        expect(provider.credentialKey).toBeDefined();
        expect(isProviderConnected(provider.id, {})).toBe(false);
        expect(isProviderConnected(provider.id, { [provider.credentialKey!]: true })).toBe(true);
      }
    }
    expect(isProviderConnected('unknown-provider', { anyKey: true })).toBe(false);
  });

  it('keeps stored model selections that resolve to catalog models and falls back otherwise', () => {
    expect(parseSelectedLlmModelId('qwen2.5-coder')).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('llama3.2-vision')).toBe('llama3.2-vision');
    expect(parseSelectedLlmModelId('gpt-5')).toBe('gpt-5');
    expect(parseSelectedLlmModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(parseSelectedLlmModelId('deepseek-r1')).toBe('deepseek-r1');

    // Null/undefined/unknown fall back to the first available model.
    expect(parseSelectedLlmModelId(null)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId(undefined)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('invalid-model-id')).toBe('qwen2.5-coder');
    expect(getLlmModel('invalid-model-id')).toBeUndefined();
  });

  it('uses openvideo storage key constants for LLM model and provider config', () => {
    expect(LLM_STORAGE_MODEL_KEY).toBe('openvideo-selected-llm-model');
    expect(LLM_STORAGE_CONFIG_KEY).toBe('openvideo-llm-provider-config');
  });
});
