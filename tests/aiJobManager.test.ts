import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from '../src/main/aiJobManager';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-ai-job-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('AI Job Manager, provider seams, and local runner execution', () => {
  it('rejects a cross-domain model id before creating a video job', async () => {
    await expect(
      createVideoGenerationJob({
        prompt: 'A local scene',
        aspectRatio: '16:9',
        durationSeconds: 3,
        mode: 'local',
        modelId: 'local-qwen-tts'
      })
    ).rejects.toThrow('is not available for video-generation');
  });

  it('rejects execution paths that do not match the selected model', async () => {
    // api mode without a model id resolves the local default → honest mismatch.
    await expect(
      createVideoGenerationJob({
        prompt: 'A cloud scene',
        aspectRatio: '16:9',
        durationSeconds: 3,
        mode: 'api'
      })
    ).rejects.toThrow('is a local model; the request asked for api execution');

    await expect(
      createSpeechGenerationJob({
        script: 'Cloud narration',
        voiceId: 'voice_01',
        mode: 'api',
        modelId: 'local-qwen-tts'
      })
    ).rejects.toThrow('is a local model; the request asked for api execution');
  });

  it('fails unconfigured local video engine jobs gracefully without falsely generating media', async () => {
    delete process.env.VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH;

    const job = await createVideoGenerationJob({
      prompt: 'A cinematic sunset over glowing ocean waves',
      aspectRatio: '16:9',
      durationSeconds: 3,
      mode: 'local'
    });

    expect(job.status).toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const failedJob = getVideoGenerationJob(job.id);
    expect(failedJob?.status).toBe('failed');
    expect(failedJob?.error).toContain('Local AI video generation runner is unconfigured');
    expect(failedJob?.outputFilePath).toBeUndefined();
  }, 10_000);

  it('passes request parameters to configured local video runner and generates valid output file', async () => {
    await withTempDirectory(async (directory) => {
      const mockRunnerPath = join(directory, 'mock-video-runner.sh');
      const scriptContent = `#!/bin/sh
for arg in "$@"; do
  if [ "$prev" = "--output-path" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf "\\x00\\x00\\x00\\x20ftypisom\\x00\\x00\\x02\\x00isomiso2avc1mp41\\x00\\x00\\x00\\x08moov" > "$out"
`;
      await writeFile(mockRunnerPath, scriptContent);
      await chmod(mockRunnerPath, 0o755);
      process.env.VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH = mockRunnerPath;

      const job = await createVideoGenerationJob({
        prompt: 'A futuristic city skyline at night',
        stylePreset: 'Cyberpunk',
        aspectRatio: '16:9',
        durationSeconds: 5,
        mode: 'local'
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const completedJob = getVideoGenerationJob(job.id);
      expect(completedJob?.status).toBe('completed');
      expect(completedJob?.outputFilePath).toBeDefined();

      if (completedJob?.outputFilePath) {
        const fileStats = await stat(completedJob.outputFilePath);
        expect(fileStats.isFile()).toBe(true);
        expect(fileStats.size).toBeGreaterThan(0);
      }

      const aiSource = getCompletedAiSource(job.id);
      expect(aiSource?.kind).toBe('video');
      expect(aiSource?.mimeType).toBe('video/mp4');

      delete process.env.VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH;
    });
  }, 10_000);

  it('rejects unimplemented cloud models before queuing a misleading job', async () => {
    // Runway/Kling/Luma/MiniMax models are honestly unavailable until their
    // adapters land, so job creation refuses them up front.
    for (const modelId of ['gen4_turbo', 'kling-v2.5-turbo', 'ray-2', 'minimax-hailuo-02']) {
      await expect(createVideoGenerationJob({
        prompt: `Test prompt for ${modelId}`,
        aspectRatio: '16:9',
        durationSeconds: 5,
        mode: 'api',
        modelId
      })).rejects.toThrow('is not available for video-generation');
    }
  });

  it('fails implemented cloud models without a connected key instead of calling out', async () => {
    const soraJob = await createVideoGenerationJob({
      prompt: 'Test prompt for Sora',
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'api',
      modelId: 'sora-2'
    });
    const elevenJob = await createSpeechGenerationJob({
      script: 'Cloud narration without a key',
      voiceId: '',
      mode: 'api',
      modelId: 'eleven_multilingual_v2'
    });
    expect(soraJob.provider).toBe('openai_sora');
    expect(elevenJob.provider).toBe('elevenlabs');

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const failedVideo = getVideoGenerationJob(soraJob.id);
    expect(failedVideo?.status).toBe('failed');
    expect(failedVideo?.error).toContain('API key is required for OpenAI Sora');
    const failedSpeech = getSpeechGenerationJob(elevenJob.id);
    expect(failedSpeech?.status).toBe('failed');
    expect(failedSpeech?.error).toContain('API key is required for ElevenLabs');
  }, 10_000);
});
