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

  it('marks only local_ollama models as available, all API-backed models as unavailable', () => {
    const availableModels = DEFAULT_LLM_MODELS.filter((m) => m.available);
    const unavailableModels = DEFAULT_LLM_MODELS.filter((m) => !m.available);

    // Only local_ollama models should be selectable
    expect(availableModels.length).toBeGreaterThan(0);
    for (const model of availableModels) {
      expect(model.providerId).toBe('local_ollama');
      expect(model.defaultMode).toBe('local');
    }

    // All API-backed models must be unavailable with a reason
    expect(unavailableModels.length).toBeGreaterThan(0);
    for (const model of unavailableModels) {
      expect(model.providerId).not.toBe('local_ollama');
      expect(model.defaultMode).toBe('api');
      expect(model.unavailabilityReason).toBeDefined();
      expect(model.unavailabilityReason!.length).toBeGreaterThan(0);
    }
  });

  it('parseSelectedLlmModelId falls back to first available model for unavailable API model IDs', () => {
    // Local available models resolve correctly
    expect(parseSelectedLlmModelId('qwen2.5-coder')).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('llama3.2-vision')).toBe('llama3.2-vision');

    // API model IDs are now unavailable — must fall back to first available local model
    expect(parseSelectedLlmModelId('gpt-5')).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('claude-sonnet-5')).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('deepseek-r1')).toBe('qwen2.5-coder');

    // Null/undefined/unknown still fall back to first available
    expect(parseSelectedLlmModelId(null)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId(undefined)).toBe('qwen2.5-coder');
    expect(parseSelectedLlmModelId('invalid-model-id')).toBe('qwen2.5-coder');
  });

  it('uses openvideo storage key constants for LLM model and provider config', () => {
    expect(LLM_STORAGE_MODEL_KEY).toBe('openvideo-selected-llm-model');
    expect(LLM_STORAGE_CONFIG_KEY).toBe('openvideo-llm-provider-config');
  });
});
