import { describe, expect, it } from 'vitest';

import { getDomainModels } from '../src/shared/aiDomainModels';
import {
  MEDIA_CAPABILITIES_AS_OF,
  MEDIA_CAPABILITY_REGISTRY_VERSION,
  VIDEO_MODEL_CAPABILITIES,
  VIDEO_OPERATIONS,
  getVideoModelCapabilities,
  getVideoProviderBinding,
  isVideoOperationImplemented,
  validateVideoRequest,
  videoControlConstraints
} from '../src/shared/mediaCapabilityRegistry';
import { GENERATION_CAPABILITIES } from '../src/shared/aiProjectDomain';

describe('versioned media capability registry', () => {
  it('uses unique model ids and the AI project uses the same operation vocabulary', () => {
    const ids = VIDEO_MODEL_CAPABILITIES.map((model) => model.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(VIDEO_MODEL_CAPABILITIES.every((model) => model.registryVersion === MEDIA_CAPABILITY_REGISTRY_VERSION)).toBe(true);
    expect(MEDIA_CAPABILITIES_AS_OF).toBe('2026-09-02');
    expect(GENERATION_CAPABILITIES).toEqual(VIDEO_OPERATIONS);
  });

  it('records Veo provider capabilities separately from implemented request paths', () => {
    const veo = getVideoModelCapabilities('veo-3.1-generate-preview');
    expect(veo?.operations).toMatchObject({
      text_to_video: { durationSeconds: [4, 6, 8], aspectRatios: ['16:9', '9:16'], nativeAudio: true },
      reference_to_video: { durationSeconds: [8], maxReferenceImages: 3 },
      start_end: { minReferenceImages: 2, maxReferenceImages: 2 },
      video_extend: { durationSeconds: [7], resolutions: ['720p'] }
    });
    expect(veo?.implemented).toEqual(['text_to_video', 'image_to_video']);
    expect(isVideoOperationImplemented(veo!.modelId, 'start_end')).toBe(false);
    expect(getVideoProviderBinding(veo!.modelId)).toEqual({
      adapterId: 'google_veo', credentialKey: 'geminiApiKey', seamProviderId: 'gemini_veo'
    });
  });

  it('lists current xAI capabilities without pretending the deferred adapter runs', () => {
    const grok = getVideoModelCapabilities('grok-imagine-video-1.5');
    expect(grok?.providerId).toBe('xai');
    expect(Object.keys(grok?.operations ?? {})).toEqual(['text_to_video', 'image_to_video', 'reference_to_video']);
    expect(grok?.operations.text_to_video?.resolutions).toEqual(['480p', '720p', '1080p']);
    expect(grok?.implemented).toEqual([]);
    expect(grok?.sourceUrls).toContain('https://docs.x.ai/developers/model-capabilities/video/generation');
    expect(getVideoProviderBinding(grok!.modelId)).toBeUndefined();
  });

  it('validates every constraint before execution and distinguishes not implemented', () => {
    expect(validateVideoRequest({
      modelId: 'veo-3.1-generate-preview', operation: 'text_to_video', durationSeconds: 6,
      aspectRatio: '9:16', referenceImageCount: 0
    }).ok).toBe(true);
    expect(validateVideoRequest({
      modelId: 'veo-3.1-generate-preview', operation: 'text_to_video', durationSeconds: 5,
      aspectRatio: '9:16', referenceImageCount: 0
    })).toMatchObject({ ok: false, code: 'INVALID_DURATION' });
    expect(validateVideoRequest({
      modelId: 'veo-3.1-generate-preview', operation: 'start_end', durationSeconds: 8,
      aspectRatio: '16:9', referenceImageCount: 2
    })).toMatchObject({ ok: false, code: 'NOT_IMPLEMENTED' });
    expect(validateVideoRequest({
      modelId: 'veo-3.1-generate-preview', operation: 'start_end', durationSeconds: 8,
      aspectRatio: '16:9', referenceImageCount: 1, requireImplemented: false
    })).toMatchObject({ ok: false, code: 'INVALID_REFERENCE_COUNT' });
  });

  it('drives controls and catalog runnable state from model-level capabilities', () => {
    expect(videoControlConstraints('veo-3.0-generate-001').durationSeconds).toEqual([8]);
    expect(videoControlConstraints('seedance2').durationSeconds.at(-1)).toBe(15);
    expect(videoControlConstraints('google_gemini').durationSeconds).toEqual([4, 6, 8]);

    for (const catalogModel of getDomainModels('video-generation')) {
      const capabilityModel = getVideoModelCapabilities(catalogModel.id);
      expect(capabilityModel, catalogModel.id).toBeDefined();
      expect(catalogModel.available, catalogModel.id).toBe(capabilityModel?.implemented.includes('text_to_video') === true);
    }
  });
});
