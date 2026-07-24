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

  it('reports the correct provider name for every cloud video provider, never a generic fallback', async () => {
    const providers: Array<{ id: 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream'; label: string }> = [
      { id: 'openai_sora', label: 'OpenAI Sora' },
      { id: 'runway_gen4', label: 'Runway Gen-4' },
      { id: 'kling_v3', label: 'Kling 3.0' },
      { id: 'luma_dream', label: 'Luma Dream' }
    ];

    for (const { id, label } of providers) {
      const job = await createVideoGenerationJob({
        prompt: `Test prompt for ${label}`,
        aspectRatio: '16:9',
        durationSeconds: 5,
        mode: 'api',
        provider: id,
        apiKey: 'sk-test-key-12345'
      });

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const failedJob = getVideoGenerationJob(job.id);
      expect(failedJob?.status).toBe('failed');
      expect(failedJob?.error).toContain(`${label} API service endpoint is currently unconfigured`);
    }
  }, 20_000);
});
