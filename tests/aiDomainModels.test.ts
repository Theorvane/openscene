import { describe, expect, it } from 'vitest';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getAvailableDomainModels,
  getDomainModel,
  parseAiDomainModelPreferences
} from '../src/shared/aiDomainModels';

describe('AI domain model catalog', () => {
  it('exposes an independent available local model for each AI domain', () => {
    expect(getAvailableDomainModels('voice-generation').map((model) => model.id)).toEqual(['local-qwen-tts']);
    expect(getAvailableDomainModels('video-generation').map((model) => model.id)).toEqual(['local-video-runner']);
    expect(getAvailableDomainModels('edit-agent').map((model) => model.id)).toEqual([
      'qwen2.5-coder',
      'gpt-5-mini',
      'gpt-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
      'gemini-3-pro',
      'deepseek-v3.1'
    ]);
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
