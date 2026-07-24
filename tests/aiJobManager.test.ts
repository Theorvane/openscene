import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from '../src/main/aiJobManager';

describe('AI Job Manager, provider seams, and local asset synthesis', () => {
  it('creates and executes a local video generation job producing a valid non-empty MP4 asset', async () => {
    const job = await createVideoGenerationJob({
      prompt: 'A cinematic sunset over glowing ocean waves',
      aspectRatio: '16:9',
      durationSeconds: 3,
      mode: 'local'
    });

    expect(job.id).toContain('video-job-');
    expect(job.provider).toBe('local_video');
    expect(job.mode).toBe('local');
    expect(job.status).toBe('queued');

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const completedJob = getVideoGenerationJob(job.id);
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.outputFilePath).toBeDefined();

    if (completedJob?.outputFilePath) {
      const fileStats = await stat(completedJob.outputFilePath);
      expect(fileStats.isFile()).toBe(true);
      expect(fileStats.size).toBeGreaterThan(0);

      const buffer = await readFile(completedJob.outputFilePath);
      expect(buffer.toString('utf8', 4, 8)).toBe('ftyp');
    }

    const aiSource = getCompletedAiSource(job.id);
    expect(aiSource).not.toBeNull();
    expect(aiSource?.kind).toBe('video');
    expect(aiSource?.mimeType).toBe('video/mp4');
  }, 10_000);

  it('creates and executes a local speech synthesis job producing a valid non-empty WAV audio asset', async () => {
    const job = await createSpeechGenerationJob({
      script: 'Antigravity AI video editor speech test.',
      voiceId: 'qwen-neutral',
      mode: 'local'
    });

    expect(job.id).toContain('speech-job-');
    expect(job.provider).toBe('local_qwen');
    expect(job.mode).toBe('local');
    expect(job.status).toBe('queued');

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const completedJob = getSpeechGenerationJob(job.id);
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.outputFilePath).toBeDefined();

    if (completedJob?.outputFilePath) {
      const fileStats = await stat(completedJob.outputFilePath);
      expect(fileStats.isFile()).toBe(true);
      expect(fileStats.size).toBeGreaterThan(44);

      const buffer = await readFile(completedJob.outputFilePath);
      expect(buffer.toString('utf8', 0, 4)).toBe('RIFF');
      expect(buffer.toString('utf8', 8, 12)).toBe('WAVE');
    }

    const aiSource = getCompletedAiSource(job.id);
    expect(aiSource).not.toBeNull();
    expect(aiSource?.kind).toBe('audio');
    expect(aiSource?.mimeType).toBe('audio/wav');
  }, 10_000);

  it('fails API mode video jobs cleanly when API key is missing or endpoint is unconfigured', async () => {
    const jobWithoutKey = await createVideoGenerationJob({
      prompt: 'Test prompt for Sora',
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'api',
      provider: 'openai_sora'
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const failedJob = getVideoGenerationJob(jobWithoutKey.id);
    expect(failedJob?.status).toBe('failed');
    expect(failedJob?.error).toContain('API key is required');

    const jobWithKey = await createVideoGenerationJob({
      prompt: 'Test prompt for Gemini',
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'api',
      provider: 'gemini_veo',
      apiKey: 'sk-test-key-12345'
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const unconfiguredJob = getVideoGenerationJob(jobWithKey.id);
    expect(unconfiguredJob?.status).toBe('failed');
    expect(unconfiguredJob?.error).toContain('Gemini Veo API service endpoint is currently unconfigured');
  }, 10_000);
});
