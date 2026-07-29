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
import { getDefaultDomainModelId, getDomainModel, type AiDomainModelConfig } from '../shared/aiDomainModels';
import { discoverFfmpeg } from './ffmpegDiscovery';
import type { CredentialStore } from './credentialStore';
import {
  generateElevenLabsSpeech,
  generateOpenAiSpeech,
  generateSoraVideo,
  generateVeoVideo
} from './mediaGenerationAdapters';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();
let activeCredentialStore: CredentialStore | undefined;

export function setAiJobManagerCredentialStore(store?: CredentialStore | undefined): void {
  activeCredentialStore = store;
}

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

const VIDEO_PROVIDER_LABELS: Record<VideoGenerationProviderId, string> = {
  gemini_veo: 'Google Veo',
  openai_sora: 'OpenAI Sora',
  runway_gen4: 'Runway',
  kling_v3: 'Kling',
  luma_dream: 'Luma',
  minimax_hailuo: 'MiniMax Hailuo',
  local_video: 'Local Engine'
};

/** Map a domain-model provider id onto the job seam ids and its credential slot. */
const VIDEO_MODEL_PROVIDERS: Record<string, { seam: VideoGenerationProviderId; credentialKey: string }> = {
  google_gemini: { seam: 'gemini_veo', credentialKey: 'geminiApiKey' },
  openai: { seam: 'openai_sora', credentialKey: 'openaiApiKey' },
  runway: { seam: 'runway_gen4', credentialKey: 'runwayApiKey' },
  kling: { seam: 'kling_v3', credentialKey: 'klingApiKey' },
  luma: { seam: 'luma_dream', credentialKey: 'lumaApiKey' },
  minimax: { seam: 'minimax_hailuo', credentialKey: 'minimax' }
};

const SPEECH_MODEL_PROVIDERS: Record<string, { seam: TextToSpeechJob['provider']; credentialKey: string; label: string }> = {
  elevenlabs: { seam: 'elevenlabs', credentialKey: 'elevenlabsApiKey', label: 'ElevenLabs' },
  openai: { seam: 'openai_tts', credentialKey: 'openaiApiKey', label: 'OpenAI' },
  google_gemini: { seam: 'gemini_tts', credentialKey: 'geminiApiKey', label: 'Google Gemini' },
  groq: { seam: 'groq_tts', credentialKey: 'groq', label: 'Groq' }
};

async function invokeCloudVideoProvider(
  model: AiDomainModelConfig,
  apiKey: string,
  request: VideoGenerationRequest,
  outputFilePath: string
): Promise<CloudProviderResult> {
  const synthesisInput = {
    apiKey,
    modelId: model.id,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? ('16:9' as const),
    durationSeconds: request.durationSeconds ?? 5
  };
  try {
    let generated: { bytes: Buffer; providerJobId: string };
    if (model.providerId === 'google_gemini') {
      generated = await generateVeoVideo(synthesisInput);
    } else if (model.providerId === 'openai') {
      generated = await generateSoraVideo(synthesisInput);
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} video generation adapter is not implemented in this build.`
      };
    }
    await writeFile(outputFilePath, generated.bytes);
    return { ok: true, outputFilePath, providerJobId: generated.providerJobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud video generation failed.' };
  }
}

async function invokeCloudSpeechProvider(
  model: AiDomainModelConfig,
  apiKey: string,
  request: TextToSpeechRequest,
  outputFilePath: string
): Promise<CloudProviderResult> {
  const synthesisInput = { apiKey, modelId: model.id, voiceId: request.voiceId ?? '', script: request.script };
  try {
    let bytes: Buffer;
    if (model.providerId === 'elevenlabs') {
      bytes = await generateElevenLabsSpeech(synthesisInput);
    } else if (model.providerId === 'openai') {
      bytes = await generateOpenAiSpeech(synthesisInput);
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} speech synthesis adapter is not implemented in this build.`
      };
    }
    await writeFile(outputFilePath, bytes);
    return { ok: true, outputFilePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud speech synthesis failed.' };
  }
}

function resolveGenerationModel(
  domain: 'voice-generation' | 'video-generation',
  requestedModelId: string | undefined,
  executionPath: 'local' | 'api'
): AiDomainModelConfig {
  const modelId = requestedModelId ?? getDefaultDomainModelId(domain);
  const model = getDomainModel(domain, modelId);
  if (model === undefined || !model.available) {
    throw new Error(`Model ${modelId} is not available for ${domain}.`);
  }
  if (model.executionPath !== executionPath) {
    throw new Error(`Model ${modelId} is a ${model.executionPath} model; the request asked for ${executionPath} execution.`);
  }
  return model;
}

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const mode = request.mode ?? 'local';
  const model = resolveGenerationModel('video-generation', request.modelId, mode);
  const providerMapping = VIDEO_MODEL_PROVIDERS[model.providerId];
  const provider: VideoGenerationProviderId = mode === 'api'
    ? (providerMapping?.seam ?? 'gemini_veo')
    : 'local_video';
  const modelId = model.id;
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
    modelId,
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
        let apiKey = request.apiKey?.trim();
        if ((!apiKey || apiKey.length === 0) && activeCredentialStore) {
          apiKey = await activeCredentialStore.getCredentialValue(providerMapping?.credentialKey ?? 'geminiApiKey');
        }

        if (!apiKey || apiKey.length === 0) {
          throw new Error(`API key is required for ${VIDEO_PROVIDER_LABELS[provider]} cloud generation. Connect the provider in Settings first.`);
        }

        const filePath = join(videoDir, `${id}.mp4`);
        const cloudResult = await invokeCloudVideoProvider(model, apiKey, request, filePath);
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

export async function createSpeechGenerationJob(request: TextToSpeechRequest): Promise<TextToSpeechJob> {
  const mode = request.mode ?? 'local';
  const model = resolveGenerationModel('voice-generation', request.modelId, mode);
  const speechMapping = SPEECH_MODEL_PROVIDERS[model.providerId];
  const provider: TextToSpeechJob['provider'] = mode === 'api' ? (speechMapping?.seam ?? 'elevenlabs') : 'local_qwen';
  const modelId = model.id;
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const job: TextToSpeechJob = {
    id,
    provider,
    mode,
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId || (mode === 'api' ? '' : 'qwen-neutral'),
    modelId,
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
        let apiKey = request.apiKey?.trim();
        if ((!apiKey || apiKey.length === 0) && activeCredentialStore) {
          apiKey = await activeCredentialStore.getCredentialValue(speechMapping?.credentialKey ?? 'elevenlabsApiKey');
        }

        if (!apiKey || apiKey.length === 0) {
          throw new Error(`API key is required for ${speechMapping?.label ?? 'cloud'} speech synthesis. Connect the provider in Settings first.`);
        }

        const filePath = join(speechDir, `${id}.mp3`);
        const cloudResult = await invokeCloudSpeechProvider(model, apiKey, request, filePath);
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
  const videoJob = videoJobs.get(jobId);
  if (videoJob && videoJob.status === 'completed' && videoJob.outputFilePath) {
    return {
      sourcePath: videoJob.outputFilePath,
      displayName: `AI_Video_${videoJob.id.slice(-6)}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4'
    };
  }

  const speechJob = speechJobs.get(jobId);
  if (speechJob && speechJob.status === 'completed' && speechJob.outputFilePath) {
    const isMp3 = speechJob.outputFilePath.toLowerCase().endsWith('.mp3');
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.${isMp3 ? 'mp3' : 'wav'}`,
      kind: 'audio',
      mimeType: isMp3 ? 'audio/mpeg' : 'audio/wav'
    };
  }

  return null;
}
