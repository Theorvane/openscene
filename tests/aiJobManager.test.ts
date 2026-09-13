import { describe, expect, it, vi } from 'vitest';
import {
  createImageGenerationJob,
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  openCompletedSpeechPreviewSource,
  getSpeechGenerationJob,
  getVideoGenerationJob,
  getImageGenerationJob,
  setAiJobManagerBrowserImageGenerator,
  setAiJobManagerBrowserVideoGenerator
} from '../src/main/aiJobManager';
import { createVoiceDeliverySettings } from '../src/shared/voiceDelivery';
import { BrowserGenerationActionRequiredError } from '../src/main/browserGenerationAction';

describe('AI Job Manager and cloud provider seams', () => {
  it('rejects a cross-domain model id before creating a video job', async () => {
    await expect(
      createVideoGenerationJob({
        prompt: 'A cloud scene',
        aspectRatio: '16:9',
        durationSeconds: 3,
        modelId: 'eleven_multilingual_v2'
      })
    ).rejects.toThrow('is not available for video-generation');
  });

  it('rejects unimplemented cloud models before queuing a misleading job', async () => {
    // Kling and MiniMax stay honestly unavailable until their adapters land, and
    // Aleph edits a source video this build does not send, so job creation
    // refuses all three up front. Runway and Luma moved out of this list when
    // their adapters landed.
    for (const modelId of ['kling-v2.5-turbo', 'minimax-hailuo-02', 'aleph2', 'veo-3.0-generate-001', 'veo-3.0-fast-generate-001']) {
      await expect(createVideoGenerationJob({
        prompt: `Test prompt for ${modelId}`,
        aspectRatio: '16:9',
        durationSeconds: 5,
        modelId
      })).rejects.toThrow('is not available for video-generation');
    }
  });

  it('fails implemented cloud models without a connected key instead of calling out', async () => {
    const soraJob = await createVideoGenerationJob({
      prompt: 'Test prompt for Sora',
      aspectRatio: '16:9',
      durationSeconds: 4,
      modelId: 'sora-2'
    });
    const elevenJob = await createSpeechGenerationJob({
      script: 'Cloud narration without a key',
      voiceId: '',
      modelId: 'eleven_multilingual_v2'
    });
    // Every media job is a cloud job now — there is no local runner to fall back on.
    expect(soraJob.mode).toBe('api');
    expect(soraJob.provider).toBe('openai_sora');
    expect(elevenJob.mode).toBe('api');
    expect(elevenJob.provider).toBe('elevenlabs');

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const failedVideo = getVideoGenerationJob(soraJob.id);
    expect(failedVideo?.status).toBe('failed');
    expect(failedVideo?.error).toContain('API key is required for OpenAI Sora');
    expect(failedVideo).not.toHaveProperty('outputFilePath');
    const failedSpeech = getSpeechGenerationJob(elevenJob.id);
    expect(failedSpeech?.status).toBe('failed');
    expect(failedSpeech?.error).toContain('API key is required for ElevenLabs');
    // Nothing was produced, so there is no importable source.
    expect(getCompletedAiSource(soraJob.id)).toBeNull();
    expect(getCompletedAiSource(elevenJob.id)).toBeNull();
  }, 10_000);

  it('defaults each media domain to an available cloud model when no model id is supplied', async () => {
    const videoJob = await createVideoGenerationJob({
      prompt: 'Default model scene',
      aspectRatio: '16:9'
    });
    const speechJob = await createSpeechGenerationJob({ script: 'Default model narration', voiceId: '' });

    expect(videoJob.mode).toBe('api');
    expect(videoJob.durationSeconds).toBe(4);
    expect(speechJob.mode).toBe('api');
    expect(videoJob.modelId).toBeDefined();
    expect(speechJob.modelId).toBeDefined();
  });

  it('runs VieNeu locally without an API key and exposes an importable WAV', async () => {
    const wav = Buffer.alloc(46);
    wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(0xffffffff, 4); wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(96_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii'); wav.writeUInt32LE(1_000_000_000, 40); wav.writeInt16LE(42, 44);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ text: '[thở dài] Xin chào từ VieNeu.', voice_id: 'voice-north' });
      return new Response(new Uint8Array(wav), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }));
    try {
      const job = await createSpeechGenerationJob({
        script: 'Xin chào từ VieNeu.',
        delivery: createVoiceDeliverySettings('[thở dài] Xin chào từ VieNeu.'),
        voiceId: 'voice-north',
        modelId: 'vieneu-v3-turbo'
      });
      expect(job).toMatchObject({ provider: 'vieneu_local', mode: 'local', status: 'queued' });

      await new Promise((resolve) => setTimeout(resolve, 1_500));

      expect(getSpeechGenerationJob(job.id)?.status).toBe('completed');
      expect(getSpeechGenerationJob(job.id)?.previewUrl).toBe(`video-tool-asset://speech-preview/${job.id}`);
      expect(getSpeechGenerationJob(job.id)?.previewUrl).not.toContain('ai_generations');
      const previewSource = await openCompletedSpeechPreviewSource(job.id);
      expect(previewSource).toMatchObject({ byteLength: 46, mimeType: 'audio/wav' });
      await previewSource?.file.close();
      expect(getCompletedAiSource(job.id)).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' });
      expect(getCompletedAiSource(job.id)?.displayName).toMatch(/\.wav$/);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 10_000);

  it('runs Flow images through the injected browser session without an API key and defaults its window visible', async () => {
    const generatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const generate = vi.fn(async () => ({
      bytes: generatedPng,
      mimeType: 'image/png',
      providerJobId: 'gemini-browser-test'
    }));
    setAiJobManagerBrowserImageGenerator(generate);
    try {
      const job = await createImageGenerationJob({
        prompt: 'A cinematic apple',
        aspectRatio: '16:9',
        stylePreset: 'Cinematic',
        negativePrompt: 'text',
        modelId: 'gemini-3.1-flash-image',
        mode: 'browser_session'
      });
      expect(job).toMatchObject({ mode: 'browser_session', provider: 'google_nano_banana', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(generate).toHaveBeenCalledWith({
        modelId: 'gemini-3.1-flash-image',
        prompt: 'A cinematic apple',
        aspectRatio: '16:9',
        showBrowserWindow: true,
        stylePreset: 'Cinematic',
        negativePrompt: 'text'
      });
      expect(getImageGenerationJob(job.id)).toMatchObject({
        status: 'completed',
        previewMimeType: 'image/png',
        previewBase64: generatedPng.toString('base64')
      });
      expect(getCompletedAiSource(job.id)).toMatchObject({
        kind: 'image',
        mimeType: 'image/png'
      });
      expect(getCompletedAiSource(job.id)?.displayName).toMatch(/\.png$/);
    } finally {
      setAiJobManagerBrowserImageGenerator(undefined);
    }
  });

  it('runs Flow video through the injected browser session without an API key', async () => {
    const generatedMp4 = Buffer.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d
    ]);
    const generate = vi.fn(async () => ({
      bytes: generatedMp4,
      providerJobId: 'google-flow-browser-video-test'
    }));
    setAiJobManagerBrowserVideoGenerator(generate);
    try {
      const job = await createVideoGenerationJob({
        prompt: 'A quiet sunrise above the clouds',
        aspectRatio: '9:16',
        durationSeconds: 4,
        stylePreset: 'Cinematic',
        modelId: 'gemini-omni-1.1-flash',
        mode: 'browser_session',
        showBrowserWindow: false,
        flowProjectName: 'Vertical trailer'
      });
      expect(job).toMatchObject({ mode: 'browser_session', provider: 'gemini_omni', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(generate).toHaveBeenCalledWith({
        modelId: 'gemini-omni-1.1-flash',
        prompt: 'A quiet sunrise above the clouds',
        operation: 'text_to_video',
        aspectRatio: '9:16',
        durationSeconds: 4,
        stylePreset: 'Cinematic',
        showBrowserWindow: false,
        projectName: 'Vertical trailer'
      });
      expect(getVideoGenerationJob(job.id)).toMatchObject({
        status: 'completed',
        mode: 'browser_session',
        providerJobId: 'google-flow-browser-video-test'
      });
      expect(getVideoGenerationJob(job.id)).not.toHaveProperty('outputFilePath');
      expect(getCompletedAiSource(job.id)?.sourcePath).toMatch(/\.mp4$/);
    } finally {
      setAiJobManagerBrowserVideoGenerator(undefined);
    }
  }, 10_000);

  it('routes Grok Imagine image and video jobs through the signed-in browser seam', async () => {
    const generatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const generatedMp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const imageGenerate = vi.fn(async () => ({ bytes: generatedPng, mimeType: 'image/png' as const, providerJobId: 'grok-image-test' }));
    const videoGenerate = vi.fn(async () => ({ bytes: generatedMp4, providerJobId: 'grok-video-test' }));
    setAiJobManagerBrowserImageGenerator(imageGenerate);
    setAiJobManagerBrowserVideoGenerator(videoGenerate);
    try {
      const imageJob = await createImageGenerationJob({ prompt: 'A fox', aspectRatio: '1:1', modelId: 'grok-imagine-image' });
      const videoJob = await createVideoGenerationJob({ prompt: 'A fox runs', aspectRatio: '16:9', durationSeconds: 6, modelId: 'grok-imagine-video-1.5' });
      expect(imageJob).toMatchObject({ mode: 'browser_session', provider: 'grok_imagine' });
      expect(videoJob).toMatchObject({ mode: 'browser_session', provider: 'grok_imagine' });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(imageGenerate).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'grok-imagine-image', showBrowserWindow: true }));
      expect(videoGenerate).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'grok-imagine-video-1.5', operation: 'text_to_video', durationSeconds: 6 }));
      expect(getImageGenerationJob(imageJob.id)?.status).toBe('completed');
      expect(getVideoGenerationJob(videoJob.id)?.status).toBe('completed');
    } finally {
      setAiJobManagerBrowserImageGenerator(undefined);
      setAiJobManagerBrowserVideoGenerator(undefined);
    }
  }, 10_000);

  it('preserves browser account interventions as needs_user_action without exposing private output state', async () => {
    const imageGenerate = vi.fn(async () => {
      throw new BrowserGenerationActionRequiredError('verification', 'Complete the provider verification, then start a new generation.');
    });
    const videoGenerate = vi.fn(async () => {
      throw new BrowserGenerationActionRequiredError('rate_limit', 'Check the provider account limit before starting a new generation.');
    });
    setAiJobManagerBrowserImageGenerator(imageGenerate);
    setAiJobManagerBrowserVideoGenerator(videoGenerate);
    try {
      const imageJob = await createImageGenerationJob({
        prompt: 'An image requiring account verification', aspectRatio: '1:1', modelId: 'grok-imagine-image'
      });
      const videoJob = await createVideoGenerationJob({
        prompt: 'A video at an account limit', aspectRatio: '16:9', durationSeconds: 6, modelId: 'grok-imagine-video-1.5'
      });
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      expect(getImageGenerationJob(imageJob.id)).toMatchObject({
        status: 'needs_user_action', actionRequired: 'verification',
        error: 'Complete the provider verification, then start a new generation.'
      });
      expect(getVideoGenerationJob(videoJob.id)).toMatchObject({
        status: 'needs_user_action', actionRequired: 'rate_limit',
        error: 'Check the provider account limit before starting a new generation.'
      });
      expect(getImageGenerationJob(imageJob.id)).not.toHaveProperty('outputFilePath');
      expect(getVideoGenerationJob(videoJob.id)).not.toHaveProperty('outputFilePath');
      expect(getCompletedAiSource(imageJob.id)).toBeNull();
      expect(getCompletedAiSource(videoJob.id)).toBeNull();
    } finally {
      setAiJobManagerBrowserImageGenerator(undefined);
      setAiJobManagerBrowserVideoGenerator(undefined);
    }
  }, 10_000);

  it('rejects video models and controls without an exact Flow counterpart before queuing', async () => {
    await expect(createVideoGenerationJob({
      prompt: 'Unsupported Flow model', aspectRatio: '16:9', durationSeconds: 8,
      modelId: 'veo-2.0-generate-001', mode: 'browser_session'
    })).rejects.toThrow(/no exact counterpart/);
    await expect(createVideoGenerationJob({
      prompt: 'Unsupported Flow duration', aspectRatio: '16:9', durationSeconds: 6,
      modelId: 'veo-3.1-generate-preview', mode: 'browser_session'
    })).rejects.toThrow(/accepts 8 second clips/);
    await expect(createVideoGenerationJob({
      prompt: 'Wrong provider', aspectRatio: '16:9', durationSeconds: 4,
      modelId: 'sora-2', mode: 'browser_session'
    })).rejects.toThrow(/explicitly supported Google Flow or Grok Imagine/);
  });

  it('does not let a non-Gemini model masquerade as a browser-session job', async () => {
    await expect(createImageGenerationJob({
      prompt: 'A protected boundary',
      aspectRatio: '1:1',
      modelId: 'gpt-image-1',
      mode: 'browser_session'
    })).rejects.toThrow('explicitly supported Google Flow or Grok Imagine');
  });

  it('rejects invalid model controls before a job or provider call is queued', async () => {
    await expect(createVideoGenerationJob({
      prompt: 'Invalid square Veo request', aspectRatio: '1:1', durationSeconds: 4,
      modelId: 'veo-3.1-generate-preview'
    })).rejects.toThrow(/accepts 16:9 or 9:16/);
    await expect(createVideoGenerationJob({
      prompt: 'Invalid Sora duration', aspectRatio: '16:9', durationSeconds: 5,
      modelId: 'sora-2'
    })).rejects.toThrow(/accepts 4, 8, 12 second/);
    await expect(createVideoGenerationJob({
      prompt: 'Missing Start-End first frame', aspectRatio: '16:9', durationSeconds: 8,
      modelId: 'veo-3.1-generate-preview', operation: 'start_end',
      lastFrame: { displayName: 'last.png', mimeType: 'image/png', base64: 'LAST' }
    })).rejects.toThrow(/both a first frame and a last frame/);
  });

  it('rejects invalid expressive delivery before queuing speech', async () => {
    await expect(createSpeechGenerationJob({
      script: 'Clean captions.', voiceId: 'voice', modelId: 'eleven_v3',
      delivery: { ...createVoiceDeliverySettings('Spoken text.'), speed: 3 }
    })).rejects.toThrow('Voice delivery settings are invalid');
  });
});
