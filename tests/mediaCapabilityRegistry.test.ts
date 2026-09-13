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
    expect(MEDIA_CAPABILITIES_AS_OF).toBe('2026-09-09');
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
    expect(veo?.implemented).toEqual(['text_to_video', 'image_to_video', 'reference_to_video', 'start_end']);
    expect(isVideoOperationImplemented(veo!.modelId, 'start_end')).toBe(true);
    expect(getVideoProviderBinding(veo!.modelId)).toEqual({
      adapterId: 'google_veo', credentialKey: 'geminiApiKey', seamProviderId: 'gemini_veo'
    });
  });

  it('lists current xAI capabilities with an explicitly scoped signed-in browser lane', () => {
    const grok = getVideoModelCapabilities('grok-imagine-video-1.5');
    expect(grok?.providerId).toBe('xai');
    expect(Object.keys(grok?.operations ?? {})).toEqual(['text_to_video', 'image_to_video', 'reference_to_video']);
    expect(grok?.operations.text_to_video?.resolutions).toEqual(['480p']);
    expect(grok?.implemented).toEqual(['text_to_video', 'image_to_video']);
    expect(grok?.sourceUrls).toContain('https://docs.x.ai/developers/model-capabilities/video/generation');
    expect(getVideoProviderBinding(grok!.modelId)).toEqual({
      adapterId: 'grok_imagine_browser', seamProviderId: 'grok_imagine'
    });
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
    })).toMatchObject({ ok: true });
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
      expect(catalogModel.available, catalogModel.id).toBe((capabilityModel?.implemented.length ?? 0) > 0);
    }
  });

  it('registers the current Veo 3.1 Fast and Lite variants without inventing Lite reference mode', () => {
    const fast = getVideoModelCapabilities('veo-3.1-fast-generate-preview');
    expect(fast?.implemented).toEqual(['text_to_video', 'image_to_video', 'reference_to_video', 'start_end']);
    expect(fast?.operations.text_to_video?.durationSeconds).toEqual([4, 6, 8]);
    const lite = getVideoModelCapabilities('veo-3.1-lite-generate-preview');
    expect(lite?.implemented).toEqual(['text_to_video', 'image_to_video', 'start_end']);
    expect(lite?.operations.reference_to_video).toBeUndefined();
    expect(lite?.operations.video_extend).toBeUndefined();
    expect(lite?.operations.text_to_video?.resolutions).toEqual(['720p', '1080p']);
    expect(getDomainModels('video-generation').find((model) => model.id === 'veo-3.0-generate-001')).toMatchObject({ available: false });
  });

  it('registers direct Gemini Omni separately from the Runway-hosted route', () => {
    const omni = getVideoModelCapabilities('gemini-omni-1.1-flash');
    expect(omni?.providerId).toBe('google_gemini');
    expect(omni?.operations).toMatchObject({
      text_to_video: { durationSeconds: [3, 4, 5, 6, 7, 8, 9, 10], aspectRatios: ['16:9', '9:16'], nativeAudio: true },
      image_to_video: { minReferenceImages: 1, maxReferenceImages: 1 },
      start_end: { minReferenceImages: 2, maxReferenceImages: 2 },
      reference_to_video: { minReferenceImages: 1, maxReferenceImages: 3 }
    });
    expect(omni?.implemented).toEqual(['text_to_video', 'image_to_video', 'start_end', 'reference_to_video']);
    expect(getVideoProviderBinding(omni!.modelId)).toEqual({
      adapterId: 'google_omni', credentialKey: 'geminiApiKey', seamProviderId: 'gemini_omni'
    });
    expect(getVideoModelCapabilities('gemini_omni_flash')?.providerId).toBe('runway');
  });

  it('registers Wan Animate as a desktop-local motion-only workflow', () => {
    const wan = getVideoModelCapabilities('wan2.2-animate-14b-comfyui');
    expect(wan?.implemented).toEqual(['motion_control']);
    expect(wan?.operations.motion_control).toMatchObject({ minReferenceImages: 1, maxReferenceImages: 1, nativeAudio: false });
    expect(getVideoProviderBinding(wan!.modelId)).toEqual({ adapterId: 'comfyui_wan', seamProviderId: 'comfyui_wan' });
    const catalog = getDomainModels('video-generation').find((model) => model.id === wan?.modelId);
    expect(catalog).toMatchObject({ available: true, executionPath: 'local', availableOn: ['desktop'] });
  });
});
