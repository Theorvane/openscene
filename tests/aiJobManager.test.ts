import { describe, expect, it } from 'vitest';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from '../src/main/aiJobManager';

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
    // Runway/Kling/Luma/MiniMax models stay honestly unavailable until their
    // adapters land, so job creation refuses them up front.
    for (const modelId of ['gen4_turbo', 'kling-v2.5-turbo', 'ray-2', 'minimax-hailuo-02']) {
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
      durationSeconds: 5,
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
    expect(failedVideo?.outputFilePath).toBeUndefined();
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
      aspectRatio: '16:9',
      durationSeconds: 5
    });
    const speechJob = await createSpeechGenerationJob({ script: 'Default model narration', voiceId: '' });

    expect(videoJob.mode).toBe('api');
    expect(speechJob.mode).toBe('api');
    expect(videoJob.modelId).toBeDefined();
    expect(speechJob.modelId).toBeDefined();
  });
});
