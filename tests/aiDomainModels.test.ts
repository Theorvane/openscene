import { describe, expect, it } from 'vitest';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getAvailableDomainModels,
  getDomainModel,
  parseAiDomainModelPreferences
} from '../src/shared/aiDomainModels';

describe('AI domain model catalog', () => {
  it('exposes an independent available local model for each AI domain', () => {
    const voiceModels = getAvailableDomainModels('voice-generation').map((model) => model.id);
    expect(voiceModels[0]).toBe('local-qwen-tts');
    expect(voiceModels).toContain('eleven_multilingual_v2');
    expect(voiceModels).toContain('gpt-4o-mini-tts');
    const videoModels = getAvailableDomainModels('video-generation').map((model) => model.id);
    expect(videoModels[0]).toBe('local-video-runner');
    expect(videoModels).toContain('veo-3.0-generate-001');
    expect(videoModels).toContain('sora-2');
    const editAgentModels = getAvailableDomainModels('edit-agent');
    expect(editAgentModels[0]?.id).toBe('qwen2.5-coder');
    // The full opencode/models.dev catalog contributes every tool-calling model.
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
    expect(getDomainModel('edit-agent', 'local-video-runner')).toBeUndefined();
    expect(getDomainModel('voice-generation', 'qwen2.5-coder')).toBeUndefined();
  });

  it('normalizes stale, unavailable, and cross-domain selections to each domain default', () => {
    expect(
      parseAiDomainModelPreferences({
        'voice-generation': 'gemini-veo',
        'video-generation': 'local-qwen-tts',
        'edit-agent': 'unknown-model'
      })
    ).toEqual({
      'voice-generation': 'local-qwen-tts',
      'video-generation': 'local-video-runner',
      'edit-agent': 'qwen2.5-coder'
    });
  });

  it('uses a versioned non-secret storage key', () => {
    expect(AI_DOMAIN_MODEL_STORAGE_KEY).toBe('openvideo-ai-domain-model-preferences-v1');
  });

  it('uses independent default selections for every domain', () => {
    expect(parseAiDomainModelPreferences(null)).toEqual({
      'voice-generation': 'local-qwen-tts',
      'video-generation': 'local-video-runner',
      'edit-agent': 'qwen2.5-coder'
    });
  });
});
