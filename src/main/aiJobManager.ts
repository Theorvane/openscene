import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

type CloudProviderResult =
  | { readonly ok: true; readonly outputFilePath?: string; readonly providerJobId?: string }
  | { readonly ok: false; readonly error: string };

const VIDEO_PROVIDER_LABELS: Record<VideoGenerationProviderId, string> = {
  gemini_veo: 'Google Veo',
  openai_sora: 'OpenAI Sora',
  runway_gen4: 'Runway',
  kling_v3: 'Kling',
  luma_dream: 'Luma',
  minimax_hailuo: 'MiniMax Hailuo'
};

/** Map a domain-model provider id onto the job seam ids and its credential slot. */
const VIDEO_MODEL_PROVIDERS: Record<string, { seam: VideoGenerationProviderId; credentialKey: string }> = {
  google_gemini: { seam: 'gemini_veo', credentialKey: 'geminiApiKey' },
  openai: { seam: 'openai_sora', credentialKey: 'openaiApiKey' },
  runway: { seam: 'runway_gen4', credentialKey: 'runwayApiKey' },
  kling: { seam: 'kling_v3', credentialKey: 'klingApiKey' },
  luma: { seam: 'luma_dream', credentialKey: 'lumaApiKey' },
  minimax_hailuo: { seam: 'minimax_hailuo', credentialKey: 'minimax' }
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
    durationSeconds: request.durationSeconds ?? 5,
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage })
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

/** Media generation is cloud-only: every selectable model runs against a provider API. */
function resolveGenerationModel(
  domain: 'voice-generation' | 'video-generation',
  requestedModelId: string | undefined
): AiDomainModelConfig {
  const modelId = requestedModelId ?? getDefaultDomainModelId(domain);
  const model = getDomainModel(domain, modelId);
  if (model === undefined || !model.available) {
    throw new Error(`Model ${modelId} is not available for ${domain}.`);
  }
  return model;
}

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const model = resolveGenerationModel('video-generation', request.modelId);
  const providerMapping = VIDEO_MODEL_PROVIDERS[model.providerId];
  const provider: VideoGenerationProviderId = providerMapping?.seam ?? 'gemini_veo';
  const modelId = model.id;
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const now = new Date().toISOString();

  const job: VideoGenerationJob = {
    id,
    provider,
    mode: 'api',
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

      let apiKey = request.apiKey?.trim();
      if ((!apiKey || apiKey.length === 0) && activeCredentialStore) {
        apiKey = await activeCredentialStore.getCredentialValue(providerMapping?.credentialKey ?? 'geminiApiKey');
      }

      if (!apiKey || apiKey.length === 0) {
        throw new Error(`API key is required for ${VIDEO_PROVIDER_LABELS[provider]} cloud generation. Connect the provider in Settings first.`);
      }

      const cloudResult = await invokeCloudVideoProvider(model, apiKey, request, join(videoDir, `${id}.mp4`));
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
  const model = resolveGenerationModel('voice-generation', request.modelId);
  const speechMapping = SPEECH_MODEL_PROVIDERS[model.providerId];
  const provider: TextToSpeechJob['provider'] = speechMapping?.seam ?? 'elevenlabs';
  const modelId = model.id;
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const job: TextToSpeechJob = {
    id,
    provider,
    mode: 'api',
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId ?? '',
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

      let apiKey = request.apiKey?.trim();
      if ((!apiKey || apiKey.length === 0) && activeCredentialStore) {
        apiKey = await activeCredentialStore.getCredentialValue(speechMapping?.credentialKey ?? 'elevenlabsApiKey');
      }

      if (!apiKey || apiKey.length === 0) {
        throw new Error(`API key is required for ${speechMapping?.label ?? 'cloud'} speech synthesis. Connect the provider in Settings first.`);
      }

      const cloudResult = await invokeCloudSpeechProvider(model, apiKey, request, join(speechDir, `${id}.mp3`));
      if (!cloudResult.ok) {
        throw new Error(cloudResult.error);
      }

      job.status = 'completed';
      if (cloudResult.outputFilePath !== undefined) {
        job.outputFilePath = cloudResult.outputFilePath;
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
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.mp3`,
      kind: 'audio',
      mimeType: 'audio/mpeg'
    };
  }

  return null;
}
