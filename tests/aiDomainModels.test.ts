import { describe, expect, it } from 'vitest';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getAvailableDomainModels,
  getDomainModel,
  parseAiDomainModelPreferences
} from '../src/shared/aiDomainModels';

describe('AI domain model catalog', () => {
  it('exposes an independent available local model for each AI domain', () => {
    // Media generation is cloud-only; Ollama is the app's only local engine and
    // serves the Edit Agent.
    const voiceModels = getAvailableDomainModels('voice-generation');
    expect(voiceModels.every((model) => model.executionPath === 'api')).toBe(true);
    expect(voiceModels.map((model) => model.id)).toContain('eleven_multilingual_v2');
    expect(voiceModels.map((model) => model.id)).toContain('gpt-4o-mini-tts');
    const videoModels = getAvailableDomainModels('video-generation');
    expect(videoModels.every((model) => model.executionPath === 'api')).toBe(true);
    expect(videoModels.map((model) => model.id)).toContain('veo-3.0-generate-001');
    expect(videoModels.map((model) => model.id)).toContain('sora-2');
    // The Edit Agent keeps the local engine.
    const editAgentModels = getAvailableDomainModels('edit-agent');
    expect(editAgentModels[0]?.id).toBe('qwen2.5-coder');
    // The full models.dev catalog contributes every tool-calling model.
    expect(editAgentModels.length).toBeGreaterThan(500);
    const ids = editAgentModels.map((model) => model.id);
    expect(ids).toContain('openai/gpt-5');
    expect(ids).toContain('anthropic/claude-sonnet-5');
    expect(ids).toContain('deepseek/deepseek-chat');
  });

  it('keeps the local model as the edit-agent default ahead of cloud providers', () => {
    expect(getAvailableDomainModels('edit-agent')[0]?.executionPath).toBe('local');
  });

  it('never resolves a model from another domain', () => {
    expect(getDomainModel('edit-agent', 'sora-2')).toBeUndefined();
    expect(getDomainModel('voice-generation', 'qwen2.5-coder')).toBeUndefined();
  });

  it('normalizes stale, unavailable, and cross-domain selections to each domain default', () => {
    expect(
      parseAiDomainModelPreferences({
        'voice-generation': 'sora-2',
        'video-generation': 'eleven_multilingual_v2',
        'edit-agent': 'unknown-model'
      })
    ).toEqual({
      'voice-generation': 'eleven_v3',
      'video-generation': 'veo-3.1-generate-preview',
      'image-generation': 'gpt-image-1',
      'edit-agent': 'qwen2.5-coder'
    });
  });

  it('normalizes a legacy OpenAI Codex edit-agent preference before availability validation', () => {
    expect(
      parseAiDomainModelPreferences({ 'edit-agent': 'openai-codex/gpt-5' })['edit-agent']
    ).toBe('openai/gpt-5');
  });

  it('uses a versioned non-secret storage key', () => {
    expect(AI_DOMAIN_MODEL_STORAGE_KEY).toBe('openvideo-ai-domain-model-preferences-v1');
  });

  it('uses independent default selections for every domain', () => {
    // Media domains default to their first available cloud model; the Edit
    // Agent keeps the local Ollama engine.
    expect(parseAiDomainModelPreferences(null)).toEqual({
      'voice-generation': 'eleven_v3',
      'video-generation': 'veo-3.1-generate-preview',
      'image-generation': 'gpt-image-1',
      'edit-agent': 'qwen2.5-coder'
    });
  });
});
