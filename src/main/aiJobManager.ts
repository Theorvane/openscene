import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  ImageGenerationJob,
  ImageGenerationProviderId,
  ImageGenerationRequest,
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
import {
  generateBytePlusImage,
  generateImagenImage,
  generateOpenAiImage,
  imageExtensionFor,
  type GeneratedImage
} from './imageGenerationAdapters';
import { tmpdir } from 'node:os';

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();
const imageJobs = new Map<string, ImageGenerationJob>();
let activeCredentialStore: CredentialStore | undefined;

export function setAiJobManagerCredentialStore(store?: CredentialStore | undefined): void {
  activeCredentialStore = store;
}

function getAiStorageDir(): string {
  const userDataDir = app?.getPath !== undefined ? app.getPath('userData') : join(tmpdir(), 'openvideo-ai-storage');
  return join(userDataDir, 'ai_generations');
}

export async function ensureAiDirectories(): Promise<{ videoDir: string; speechDir: string; imageDir: string }> {
  const baseDir = getAiStorageDir();
  const videoDir = join(baseDir, 'video');
  const speechDir = join(baseDir, 'speech');
  const imageDir = join(baseDir, 'image');
  await mkdir(videoDir, { recursive: true });
  await mkdir(speechDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });
  return { videoDir, speechDir, imageDir };
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

const IMAGE_PROVIDER_LABELS: Record<ImageGenerationProviderId, string> = {
  openai_images: 'OpenAI Images',
  google_imagen: 'Google Imagen',
  byteplus_seedream: 'BytePlus Seedream',
  stability_image: 'Stability AI',
  flux_image: 'Black Forest Labs',
  alibaba_wan_image: 'Alibaba Wan'
};

const IMAGE_MODEL_PROVIDERS: Record<string, { seam: ImageGenerationProviderId; credentialKey: string }> = {
  openai: { seam: 'openai_images', credentialKey: 'openaiApiKey' },
  google_gemini: { seam: 'google_imagen', credentialKey: 'geminiApiKey' },
  byteplus: { seam: 'byteplus_seedream', credentialKey: 'bytePlusApiKey' },
  stability: { seam: 'stability_image', credentialKey: 'stabilityApiKey' },
  black_forest_labs: { seam: 'flux_image', credentialKey: 'blackForestLabsApiKey' },
  alibaba_dashscope: { seam: 'alibaba_wan_image', credentialKey: 'dashscopeApiKey' }
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

type CloudImageResult =
  | { readonly ok: true; readonly image: GeneratedImage }
  | { readonly ok: false; readonly error: string };

async function invokeCloudImageProvider(
  model: AiDomainModelConfig,
  apiKey: string,
  request: ImageGenerationRequest
): Promise<CloudImageResult> {
  const synthesisInput = {
    apiKey,
    modelId: model.id,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? ('1:1' as const),
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage })
  };
  try {
    let image: GeneratedImage;
    if (model.providerId === 'openai') {
      image = await generateOpenAiImage(synthesisInput);
    } else if (model.providerId === 'google_gemini') {
      image = await generateImagenImage(synthesisInput);
    } else if (model.providerId === 'byteplus') {
      image = await generateBytePlusImage(synthesisInput);
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} image generation adapter is not implemented in this build.`
      };
    }
    return { ok: true, image };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud image generation failed.' };
  }
}

/** Media generation is cloud-only: every selectable model runs against a provider API. */
function resolveGenerationModel(
  domain: 'voice-generation' | 'video-generation' | 'image-generation',
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

export async function createImageGenerationJob(request: ImageGenerationRequest): Promise<ImageGenerationJob> {
  const model = resolveGenerationModel('image-generation', request.modelId);
  const providerMapping = IMAGE_MODEL_PROVIDERS[model.providerId];
  const provider: ImageGenerationProviderId = providerMapping?.seam ?? 'openai_images';
  const { imageDir } = await ensureAiDirectories();
  const id = `image-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const job: ImageGenerationJob = {
    id,
    provider,
    mode: 'api',
    status: 'queued',
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? '1:1',
    modelId: model.id,
    ...(request.stylePreset === undefined ? {} : { stylePreset: request.stylePreset }),
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
    createdAt: now,
    updatedAt: now
  };

  imageJobs.set(id, job);

  setTimeout(async () => {
    const running: ImageGenerationJob = { ...job, status: 'running', updatedAt: new Date().toISOString() };
    imageJobs.set(id, running);
    try {
      let apiKey = request.apiKey?.trim();
      if ((apiKey === undefined || apiKey.length === 0) && activeCredentialStore) {
        apiKey = await activeCredentialStore.getCredentialValue(providerMapping?.credentialKey ?? 'openaiApiKey');
      }
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error(
          `API key is required for ${IMAGE_PROVIDER_LABELS[provider]} image generation. Connect the provider in Settings first.`
        );
      }

      const result = await invokeCloudImageProvider(model, apiKey, request);
      if (!result.ok) {
        throw new Error(result.error);
      }

      const outputFilePath = join(imageDir, `${id}.${imageExtensionFor(result.image.mimeType)}`);
      await writeFile(outputFilePath, result.image.bytes);

      imageJobs.set(id, {
        ...running,
        status: 'completed',
        outputFilePath,
        providerJobId: result.image.providerJobId,
        // Carried inline so the studio can show the result without ever
        // learning a filesystem path.
        previewMimeType: result.image.mimeType,
        previewBase64: result.image.bytes.toString('base64'),
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      imageJobs.set(id, {
        ...running,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Image generation failed',
        updatedAt: new Date().toISOString()
      });
    }
  }, 0);

  return job;
}

export function getImageGenerationJob(jobId: string): ImageGenerationJob | null {
  return imageJobs.get(jobId) ?? null;
}

/**
 * A finished image, handed back as bytes for use as a video reference. The
 * renderer gets the same inline shape a picked file would produce, so image-to
 * -video does not care whether the seed was generated or chosen from disk.
 */
export function getGeneratedImageAsReference(
  jobId: string
): { readonly displayName: string; readonly mimeType: string; readonly base64: string } | null {
  const job = imageJobs.get(jobId);
  if (job === undefined || job.status !== 'completed' || job.previewBase64 === undefined) return null;
  const mimeType = job.previewMimeType ?? 'image/png';
  return {
    displayName: `AI_Image_${job.id.slice(-6)}.${imageExtensionFor(mimeType)}`,
    mimeType,
    base64: job.previewBase64
  };
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
