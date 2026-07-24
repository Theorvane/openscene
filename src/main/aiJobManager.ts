import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  TextToSpeechJob,
  TextToSpeechRequest,
  VideoGenerationJob,
  VideoGenerationProviderId,
  VideoGenerationRequest
} from '../shared/providerSeams';
import { discoverFfmpeg } from './ffmpegDiscovery';

const execFileAsync = promisify(execFile);

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();

import { tmpdir } from 'node:os';

function getAiStorageDir(): string {
  const userDataDir = app?.getPath !== undefined ? app.getPath('userData') : join(tmpdir(), 'openvideo-ai-storage');
  return join(userDataDir, 'ai_generations');
}

export async function ensureAiDirectories(): Promise<{ videoDir: string; speechDir: string }> {
  const baseDir = getAiStorageDir();
  const videoDir = join(baseDir, 'video');
  const speechDir = join(baseDir, 'speech');
  await mkdir(videoDir, { recursive: true });
  await mkdir(speechDir, { recursive: true });
  return { videoDir, speechDir };
}

export type LocalVideoRunnerConfig = {
  readonly runnerExecutablePath?: string;
  readonly modelWeightsPath?: string;
};

export function getLocalVideoRunnerConfig(): LocalVideoRunnerConfig {
  const runnerExecutablePath = process.env.VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH?.trim();
  const modelWeightsPath = process.env.VIDEO_TOOL_LOCAL_VIDEO_MODEL_PATH?.trim();
  return {
    ...(runnerExecutablePath && runnerExecutablePath.length > 0 ? { runnerExecutablePath } : {}),
    ...(modelWeightsPath && modelWeightsPath.length > 0 ? { modelWeightsPath } : {})
  };
}

async function executeLocalVideoSynthesis(
  filePath: string,
  request: VideoGenerationRequest
): Promise<void> {
  const config = getLocalVideoRunnerConfig();
  if (!config.runnerExecutablePath) {
    throw new Error(
      'Local AI video generation runner is unconfigured. Please configure VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH or local model weights in settings.'
    );
  }

  await execFileAsync(config.runnerExecutablePath, [
    '--prompt', request.prompt,
    '--style-preset', request.stylePreset ?? 'Cinematic',
    '--aspect-ratio', request.aspectRatio ?? '16:9',
    '--duration', String(request.durationSeconds ?? 5),
    '--output-path', filePath,
    ...(config.modelWeightsPath ? ['--model-path', config.modelWeightsPath] : [])
  ]);

  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`Local video synthesis runner produced an invalid or empty file at ${filePath}.`);
  }
}

async function executeLocalSpeechSynthesis(
  filePath: string,
  request: TextToSpeechRequest
): Promise<void> {
  const runnerExecutablePath = process.env.VIDEO_TOOL_LOCAL_TTS_RUNNER_PATH?.trim();
  if (!runnerExecutablePath) {
    throw new Error(
      'Local Qwen TTS runner is unconfigured. Please configure VIDEO_TOOL_LOCAL_TTS_RUNNER_PATH or Qwen model weights in settings.'
    );
  }

  await execFileAsync(runnerExecutablePath, [
    '--script', request.script,
    '--voice-id', request.voiceId || 'qwen-neutral',
    '--output-path', filePath
  ]);

  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`Local speech synthesis runner produced an invalid or empty file at ${filePath}.`);
  }
}

type CloudProviderResult =
  | { readonly ok: true; readonly outputFilePath?: string; readonly providerJobId?: string }
  | { readonly ok: false; readonly error: string };

async function invokeCloudVideoProvider(
  provider: VideoGenerationProviderId,
  apiKey: string,
  _request: VideoGenerationRequest
): Promise<CloudProviderResult> {
  // Cloud provider adapter seam boundary for Gemini Veo / OpenAI Sora
  if (apiKey.startsWith('demo-invalid') || apiKey.length < 10) {
    return { ok: false, error: `Invalid ${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} API key.` };
  }
  return {
    ok: false,
    error: `${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} API service endpoint is currently unconfigured. Use Local Engine mode for offline video synthesis.`
  };
}

async function invokeCloudSpeechProvider(
  apiKey: string,
  _request: TextToSpeechRequest
): Promise<CloudProviderResult> {
  // Cloud provider adapter seam boundary for ElevenLabs
  if (apiKey.startsWith('demo-invalid') || apiKey.length < 10) {
    return { ok: false, error: 'Invalid ElevenLabs API key.' };
  }
  return {
    ok: false,
    error: 'ElevenLabs API service endpoint is currently unconfigured. Use Local Engine mode for offline speech synthesis.'
  };
}

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = request.mode ?? 'local';
  const provider: VideoGenerationProviderId = mode === 'api' 
    ? (request.provider ?? 'gemini_veo')
    : 'local_video';
  
  const now = new Date().toISOString();

  const job: VideoGenerationJob = {
    id,
    provider,
    mode,
    status: 'queued',
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? '16:9',
    durationSeconds: request.durationSeconds ?? 5,
    stylePreset: request.stylePreset ?? 'Cinematic',
    createdAt: now,
    updatedAt: now
  };

  videoJobs.set(id, job);

  setTimeout(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);

      if (mode === 'api') {
        const apiKey = request.apiKey?.trim();
        if (!apiKey || apiKey.length === 0) {
          throw new Error(`API key is required for ${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} cloud generation.`);
        }

        const cloudResult = await invokeCloudVideoProvider(provider, apiKey, request);
        if (!cloudResult.ok) {
          throw new Error(cloudResult.error);
        }

        job.status = 'completed';
        if (cloudResult.outputFilePath !== undefined) {
          job.outputFilePath = cloudResult.outputFilePath;
        }
        if (cloudResult.providerJobId !== undefined) {
          job.providerJobId = cloudResult.providerJobId;
        }
      } else {
        const fileName = `${id}.mp4`;
        const filePath = join(videoDir, fileName);
        await executeLocalVideoSynthesis(filePath, request);

        job.status = 'completed';
        job.outputFilePath = filePath;
      }

      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Video generation failed';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
    }
  }, 1000);

  return job;
}

export function getVideoGenerationJob(jobId: string): VideoGenerationJob | null {
  return videoJobs.get(jobId) ?? null;
}

// Generate minimal valid WAV file header buffer for audio synthesis preview
function generateMinimalWavBuffer(durationSeconds = 3): Buffer {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16384;
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }

  return buffer;
}

export async function createSpeechGenerationJob(request: TextToSpeechRequest): Promise<TextToSpeechJob> {
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = request.mode ?? 'local';
  const provider = mode === 'api' ? 'elevenlabs' : 'local_qwen';
  const now = new Date().toISOString();

  const job: TextToSpeechJob = {
    id,
    provider,
    mode,
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId || (mode === 'api' ? 'eleven-adam' : 'qwen-neutral'),
    createdAt: now,
    updatedAt: now
  };

  speechJobs.set(id, job);

  setTimeout(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);

      if (mode === 'api') {
        const apiKey = request.apiKey?.trim();
        if (!apiKey || apiKey.length === 0) {
          throw new Error('API key is required for ElevenLabs cloud speech synthesis.');
        }

        const cloudResult = await invokeCloudSpeechProvider(apiKey, request);
        if (!cloudResult.ok) {
          throw new Error(cloudResult.error);
        }

        job.status = 'completed';
        if (cloudResult.outputFilePath !== undefined) {
          job.outputFilePath = cloudResult.outputFilePath;
        }
      } else {
        const fileName = `${id}.wav`;
        const filePath = join(speechDir, fileName);
        await executeLocalSpeechSynthesis(filePath, request);

        job.status = 'completed';
        job.outputFilePath = filePath;
      }

      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Speech synthesis failed';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
    }
  }, 1000);

  return job;
}

export function getSpeechGenerationJob(jobId: string): TextToSpeechJob | null {
  return speechJobs.get(jobId) ?? null;
}

export function getCompletedAiSource(jobId: string): { sourcePath: string; displayName: string; kind: 'video' | 'audio'; mimeType: string } | null {
  const speechJob = speechJobs.get(jobId);
  if (speechJob !== undefined && speechJob.status === 'completed' && speechJob.outputFilePath) {
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.wav`,
      kind: 'audio',
      mimeType: 'audio/wav'
    };
  }
  const videoJob = videoJobs.get(jobId);
  if (videoJob !== undefined && videoJob.status === 'completed' && videoJob.outputFilePath) {
    return {
      sourcePath: videoJob.outputFilePath,
      displayName: `AI_Video_${videoJob.id.slice(-6)}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4'
    };
  }
  return null;
}
