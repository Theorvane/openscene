import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_MODELS,
  LLM_STORAGE_CONFIG_KEY,
  LLM_STORAGE_MODEL_KEY,
  parseSelectedLlmModelId
} from '../src/shared/llmModels';

describe('LLM provider and model catalog configuration', () => {
  it('defines valid LLM models with provider labels, categories, and badges', () => {
    expect(DEFAULT_LLM_MODELS.length).toBeGreaterThanOrEqual(8);

    const modelIds = DEFAULT_LLM_MODELS.map((m) => m.id);
    expect(modelIds).toContain('qwen2.5-coder');
    expect(modelIds).toContain('gpt-4o');
    expect(modelIds).toContain('claude-3-5-sonnet');
    expect(modelIds).toContain('gemini-2.0-flash');
    expect(modelIds).toContain('deepseek-r1');

    for (const model of DEFAULT_LLM_MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.providerLabel.length).toBeGreaterThan(0);
      expect(model.description.length).toBeGreaterThan(0);
      expect(['LOCAL', 'FAST', 'SMART', 'REASONING']).toContain(model.badge);
      expect(['local', 'api']).toContain(model.defaultMode);
    }
  });

  it('parses stored model IDs with fallback to default qwen2.5-coder', () => {
    expect(parseSelectedLlmModelId('gpt-4o')).toBe('gpt-4o');
    expect(parseSelectedLlmModelId('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
    expect(parseSelectedLlmModelId('deepseek-r1')).toBe('deepseek-r1');

    expect(parseSelectedLlmModelId(null)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId(undefined)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('invalid-model-id')).toBe('qwen2.5-coder');
  });

  it('uses openvideo storage key constants for LLM model and provider config', () => {
    expect(LLM_STORAGE_MODEL_KEY).toBe('openvideo-selected-llm-model');
    expect(LLM_STORAGE_CONFIG_KEY).toBe('openvideo-llm-provider-config');
  });
});
