import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from '../src/main/aiJobManager';

describe('AI Job Manager and playable asset generation', () => {
  it('creates and polls an AI video generation job producing a valid non-empty MP4 asset', async () => {
    const job = await createVideoGenerationJob({
      prompt: 'A cinematic sunset over glowing ocean waves',
      aspectRatio: '16:9',
      durationSeconds: 3,
      mode: 'api',
      provider: 'openai_sora'
    });

    expect(job.id).toContain('video-job-');
    expect(job.provider).toBe('openai_sora');
    expect(job.mode).toBe('api');
    expect(job.status).toBe('queued');

    // Wait for job execution to complete
    await new Promise((resolve) => setTimeout(resolve, 1400));

    const completedJob = getVideoGenerationJob(job.id);
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.outputFilePath).toBeDefined();

    if (completedJob?.outputFilePath) {
      const fileStats = await stat(completedJob.outputFilePath);
      expect(fileStats.isFile()).toBe(true);
      expect(fileStats.size).toBeGreaterThan(0);

      const buffer = await readFile(completedJob.outputFilePath);
      // Valid MP4 file contains 'ftyp' box
      expect(buffer.toString('utf8', 4, 8)).toBe('ftyp');
    }

    const aiSource = getCompletedAiSource(job.id);
    expect(aiSource).not.toBeNull();
    expect(aiSource?.kind).toBe('video');
    expect(aiSource?.mimeType).toBe('video/mp4');
  }, 10_000);

  it('creates and polls an AI speech synthesis job producing a valid non-empty WAV audio asset', async () => {
    const job = await createSpeechGenerationJob({
      script: 'Antigravity AI video editor speech test.',
      voiceId: 'eleven-adam',
      mode: 'api'
    });

    expect(job.id).toContain('speech-job-');
    expect(job.provider).toBe('elevenlabs');
    expect(job.status).toBe('queued');

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const completedJob = getSpeechGenerationJob(job.id);
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.outputFilePath).toBeDefined();

    if (completedJob?.outputFilePath) {
      const fileStats = await stat(completedJob.outputFilePath);
      expect(fileStats.isFile()).toBe(true);
      expect(fileStats.size).toBeGreaterThan(44); // WAV header is 44 bytes

      const buffer = await readFile(completedJob.outputFilePath);
      expect(buffer.toString('utf8', 0, 4)).toBe('RIFF');
      expect(buffer.toString('utf8', 8, 12)).toBe('WAVE');
    }

    const aiSource = getCompletedAiSource(job.id);
    expect(aiSource).not.toBeNull();
    expect(aiSource?.kind).toBe('audio');
    expect(aiSource?.mimeType).toBe('audio/wav');
  }, 10_000);
});
