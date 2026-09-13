import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
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
import { estimateImageCost, estimateSpeechCost, estimateVideoCost, type CostEstimate } from '../shared/mediaGenerationPricing';
import { getVideoOperationConstraints, getVideoProviderBinding, validateVideoRequest } from '../shared/mediaCapabilityRegistry';
import { resolveVideoOperation, validateVideoInputSet } from '../shared/videoGeneration';
import { GenerationSpendStore } from './generationSpendStore';
import { discoverFfmpeg } from './ffmpegDiscovery';
import type { CredentialStore } from './credentialStore';
import {
  generateElevenLabsSpeech,
  generateGeminiOmniVideo,
  generateLumaVideo,
  generateOpenAiSpeech,
  generateRunwayVideo,
  generateSoraVideo,
  generateVeoVideo,
  generateVieNeuSpeech,
  listVieNeuVoices
} from './mediaGenerationAdapters';
import { voiceChoices, type VoiceChoice } from '../shared/voiceCatalog';
import {
  generateBytePlusImage,
  generateNanoBananaImage,
  generateOpenAiImage,
  imageExtensionFor,
  type GeneratedImage
} from './imageGenerationAdapters';
import { tmpdir } from 'node:os';
import { speechPreviewUrl, videoPreviewUrl } from '../shared/mediaPlaybackUrls';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { isInsideDirectory } from './projectStoreSupport';
import { parseVoiceDeliverySettings, type VoiceDeliverySettings } from '../shared/voiceDelivery';
import { generateComfyUiMotionVideo } from './comfyUiMotionAdapter';
import type { VieNeuRuntimeController } from './managedVieNeuRuntime';
import { googleFlowVideoDurationOptions, googleFlowVideoModelFor } from '../shared/browserSession';
import { recoverVideoJobAfterRestart } from '../shared/videoJobRecovery';
import { VideoJobRecoveryStore, type PersistedVideoGenerationJob } from './videoJobRecoveryStore';
import { browserGenerationActionFromError } from './browserGenerationAction';

const videoJobs = new Map<string, PersistedVideoGenerationJob>();
type InternalSpeechGenerationJob = TextToSpeechJob & { outputFilePath?: string };
type InternalImageGenerationJob = ImageGenerationJob & { outputFilePath?: string };
const speechJobs = new Map<string, InternalSpeechGenerationJob>();
const imageJobs = new Map<string, InternalImageGenerationJob>();
let activeVideoJobRecoveryStore: VideoJobRecoveryStore | undefined;
let activeCredentialStore: CredentialStore | undefined;
let activeSpendStore: GenerationSpendStore | undefined;
let activeVieNeuRuntime: VieNeuRuntimeController | undefined;
type BrowserImageGenerator = (input: {
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly stylePreset?: string;
  readonly negativePrompt?: string;
  readonly referenceImage?: import('../shared/providerSeams').ReferenceImageSelection;
  readonly referenceImages?: readonly import('../shared/providerSeams').ReferenceImageSelection[];
  readonly showBrowserWindow?: boolean;
  readonly projectName?: string;
}) => Promise<GeneratedImage>;
let activeBrowserImageGenerator: BrowserImageGenerator | undefined;
type BrowserVideoGenerator = (input: {
  readonly modelId: string;
  readonly prompt: string;
  readonly operation: import('../shared/mediaCapabilityRegistry').VideoOperation;
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly stylePreset?: string;
  readonly referenceImage?: import('../shared/providerSeams').ReferenceImageSelection;
  readonly lastFrame?: import('../shared/providerSeams').ReferenceImageSelection;
  readonly referenceImages?: readonly import('../shared/providerSeams').ReferenceImageSelection[];
  readonly showBrowserWindow?: boolean;
  readonly projectName?: string;
}) => Promise<{ readonly bytes: Buffer; readonly providerJobId: string }>;
let activeBrowserVideoGenerator: BrowserVideoGenerator | undefined;
type MotionAssetSource = OpenedAssetPlaybackSource & { readonly durationMs?: number };
let activeAssetSourceResolver: ((projectId: string, assetId: string) => Promise<MotionAssetSource | null>) | undefined;

function logSpeechJob(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Speech][${jobId}] ${event}${suffix}`);
}

function logVideoJob(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Video][${jobId}] ${event}${suffix}`);
}

function logImageJob(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Image][${jobId}] ${event}${suffix}`);
}

/**
 * A charge refused before it was made.
 *
 * Its own type because the callers have to tell it apart from a provider
 * failure: nothing was generated, nothing was spent, and the user can act on
 * it by raising the ceiling or picking a cheaper model.
 */
export class GenerationSpendError extends Error {
  override readonly name = 'GenerationSpendError';
}

export function setAiJobManagerSpendStore(store?: GenerationSpendStore | undefined): void {
  activeSpendStore = store;
}

/**
 * The ceiling, checked and claimed in one step before a job is created.
 *
 * A check on its own is not a limit: two jobs asked for at once would both read
 * the same total, both pass, and both spend. The store takes the room out of
 * the ceiling as it answers, and the caller either keeps it — `settleSpend`,
 * once the request has gone to a provider — or hands it back.
 *
 * A machine with no ledger wired in — every test, and any host that has not set
 * one — is unlimited, which is what the app did before there were limits at all.
 */
async function reserveSpend(estimate: CostEstimate, acceptUnknownCost: boolean | undefined): Promise<string | null> {
  if (activeSpendStore === undefined) return null;
  const reservation = await activeSpendStore.reserve(estimate, acceptUnknownCost);
  if (!reservation.ok) throw new GenerationSpendError(reservation.reason);
  return reservation.id;
}

/**
 * Settled where the money is actually committed — as the request goes to the
 * provider, not when the job is queued. A job that never got that far because a
 * key was missing cost nothing, so its room goes back rather than being kept.
 */
async function settleSpend(reservationId: string | null, outcome: 'charged' | 'released'): Promise<void> {
  if (activeSpendStore === undefined || reservationId === null) return;
  try {
    if (outcome === 'charged') await activeSpendStore.charge(reservationId);
    else await activeSpendStore.release(reservationId);
  } catch {
    // A ledger that cannot be written must not take a generation down with it.
    // An unsettled reservation is treated as a charge once it goes stale, which
    // errs toward the user's wallet rather than against it.
  }
}

export function setAiJobManagerCredentialStore(store?: CredentialStore | undefined): void {
  activeCredentialStore = store;
}

export function setAiJobManagerVieNeuRuntime(runtime?: VieNeuRuntimeController | undefined): void {
  activeVieNeuRuntime = runtime;
}

export function setAiJobManagerBrowserImageGenerator(generator?: BrowserImageGenerator | undefined): void {
  activeBrowserImageGenerator = generator;
}

export function setAiJobManagerBrowserVideoGenerator(generator?: BrowserVideoGenerator | undefined): void {
  activeBrowserVideoGenerator = generator;
}

export function setAiJobManagerAssetSourceResolver(
  resolver?: ((projectId: string, assetId: string) => Promise<MotionAssetSource | null>) | undefined
): void {
  activeAssetSourceResolver = resolver;
}

function publicVideoJob(job: PersistedVideoGenerationJob): VideoGenerationJob {
  const { outputFilePath: _privatePath, ...publicJob } = job;
  return publicJob;
}

function publicSpeechJob(job: InternalSpeechGenerationJob): TextToSpeechJob {
  const { outputFilePath: _privatePath, ...publicJob } = job;
  return publicJob;
}

function publicImageJob(job: InternalImageGenerationJob): ImageGenerationJob {
  const { outputFilePath: _privatePath, ...publicJob } = job;
  return publicJob;
}

async function persistVideoJobs(): Promise<void> {
  await activeVideoJobRecoveryStore?.replace([...videoJobs.values()]);
}

async function persistVideoJobsBestEffort(jobId: string): Promise<void> {
  try {
    await persistVideoJobs();
  } catch {
    logVideoJob(jobId, 'recovery.persist.failed', {}, 'error');
  }
}

/**
 * Restores the local journal before IPC becomes reachable. Active work is not
 * replayed: a remote provider may already have charged and completed it.
 */
export async function initializeVideoJobRecovery(
  store: VideoJobRecoveryStore,
  options: { readonly videoDirectory?: string; readonly now?: () => Date } = {}
): Promise<void> {
  activeVideoJobRecoveryStore = store;
  const recoveredAt = (options.now?.() ?? new Date()).toISOString();
  const videoDir = options.videoDirectory ?? (await ensureAiDirectories()).videoDir;
  videoJobs.clear();
  for (const persisted of await store.load()) {
    const publicRecovered = recoverVideoJobAfterRestart(publicVideoJob(persisted), recoveredAt);
    let recovered: PersistedVideoGenerationJob = {
      ...publicRecovered,
      ...(persisted.status === 'queued' || persisted.status === 'running' || persisted.outputFilePath === undefined
        ? {}
        : { outputFilePath: persisted.outputFilePath })
    };
    if (recovered.status === 'completed') {
      const source = recovered.outputFilePath === undefined
        ? null
        : await openCompletedPreviewSource(recovered.outputFilePath, videoDir, 'video/mp4');
      if (source === null) {
        const { outputFilePath: _missingPath, ...withoutPath } = recovered;
        recovered = {
          ...withoutPath,
          status: 'failed',
          error: 'The completed video output is no longer available in local storage.',
          updatedAt: recoveredAt
        };
      } else {
        await source.file.close();
        recovered = { ...recovered, previewUrl: videoPreviewUrl(recovered.id) };
      }
    }
    videoJobs.set(recovered.id, recovered);
    if (persisted.status === 'queued' || persisted.status === 'running') {
      logVideoJob(recovered.id, 'recovery.interrupted', { automaticResubmit: false });
    }
  }
  await persistVideoJobs();
}

/** Test and shutdown seam; it does not delete the on-disk journal. */
export function setAiJobManagerVideoRecoveryStore(store?: VideoJobRecoveryStore): void {
  activeVideoJobRecoveryStore = store;
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
  gemini_omni: 'Google Gemini Omni',
  grok_imagine: 'xAI Grok Imagine',
  openai_sora: 'OpenAI Sora',
  runway_gen4: 'Runway',
  kling_v3: 'Kling',
  luma_dream: 'Luma',
  minimax_hailuo: 'MiniMax Hailuo',
  comfyui_wan: 'ComfyUI Wan'
};

const IMAGE_PROVIDER_LABELS: Record<ImageGenerationProviderId, string> = {
  openai_images: 'OpenAI Images',
  google_imagen: 'Google Imagen (legacy)',
  google_nano_banana: 'Google Nano Banana',
  grok_imagine: 'xAI Grok Imagine',
  byteplus_seedream: 'BytePlus Seedream',
  stability_image: 'Stability AI',
  flux_image: 'Black Forest Labs',
  alibaba_wan_image: 'Alibaba Wan'
};

const IMAGE_MODEL_PROVIDERS: Record<string, { seam: ImageGenerationProviderId; credentialKey: string }> = {
  openai: { seam: 'openai_images', credentialKey: 'openaiApiKey' },
  google_gemini: { seam: 'google_nano_banana', credentialKey: 'geminiApiKey' },
  xai: { seam: 'grok_imagine', credentialKey: 'xaiApiKey' },
  byteplus: { seam: 'byteplus_seedream', credentialKey: 'bytePlusApiKey' },
  stability: { seam: 'stability_image', credentialKey: 'stabilityApiKey' },
  black_forest_labs: { seam: 'flux_image', credentialKey: 'blackForestLabsApiKey' },
  alibaba_dashscope: { seam: 'alibaba_wan_image', credentialKey: 'dashscopeApiKey' }
};

const SPEECH_MODEL_PROVIDERS: Record<string, { seam: TextToSpeechJob['provider']; credentialKey?: string; label: string }> = {
  elevenlabs: { seam: 'elevenlabs', credentialKey: 'elevenlabsApiKey', label: 'ElevenLabs' },
  openai: { seam: 'openai_tts', credentialKey: 'openaiApiKey', label: 'OpenAI' },
  google_gemini: { seam: 'gemini_tts', credentialKey: 'geminiApiKey', label: 'Google Gemini' },
  groq: { seam: 'groq_tts', credentialKey: 'groq', label: 'Groq' },
  vieneu_local: { seam: 'vieneu_local', label: 'VieNeu-TTS' }
};

async function invokeCloudVideoProvider(
  jobId: string,
  model: AiDomainModelConfig,
  apiKey: string,
  request: VideoGenerationRequest & { readonly durationSeconds: number },
  outputFilePath: string
): Promise<CloudProviderResult> {
  let lastProgressLogMs = -10_000;
  const synthesisInput = {
    apiKey,
    modelId: model.id,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? ('16:9' as const),
    durationSeconds: request.durationSeconds,
    operation: resolveVideoOperation(request),
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage }),
    ...(request.lastFrame === undefined ? {} : { lastFrame: request.lastFrame }),
    ...(request.referenceImages === undefined ? {} : { referenceImages: request.referenceImages }),
    onProgress: (stage: 'submitting' | 'generating' | 'ready', elapsedMs: number) => {
      if (stage === 'generating' && elapsedMs - lastProgressLogMs < 10_000) return;
      lastProgressLogMs = elapsedMs;
      logVideoJob(jobId, `provider.${stage}`, { elapsedSeconds: Math.round(elapsedMs / 1_000) });
    }
  };
  try {
    const binding = getVideoProviderBinding(model.id);
    if (binding === undefined) {
      return { ok: false, error: `${model.providerLabel} video generation adapter is not implemented in this build.` };
    }
    // One entry per ported provider, so adding an adapter is one line rather
    // than another branch in a chain that is easy to leave a provider out of.
    if (binding.adapterId === 'comfyui_wan') {
      return { ok: false, error: 'The local ComfyUI adapter must be invoked through the project-scoped motion path.' };
    }
    const adapters: Readonly<Partial<Record<typeof binding.adapterId, (input: typeof synthesisInput) => Promise<{ bytes: Buffer; providerJobId: string }>>>> = {
      google_veo: generateVeoVideo,
      google_omni: generateGeminiOmniVideo,
      openai_sora: generateSoraVideo,
      runway: generateRunwayVideo,
      luma: generateLumaVideo
    };
    const adapter = adapters[binding.adapterId];
    if (adapter === undefined) {
      return {
        ok: false,
        error: `${model.providerLabel} video generation adapter is not implemented in this build.`
      };
    }
    const generated = await adapter(synthesisInput);
    await writeFile(outputFilePath, generated.bytes);
    return { ok: true, outputFilePath, providerJobId: generated.providerJobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud video generation failed.' };
  }
}

async function invokeSpeechProvider(
  model: AiDomainModelConfig,
  apiKey: string | undefined,
  request: TextToSpeechRequest,
  outputFilePath: string
): Promise<CloudProviderResult> {
  try {
    let bytes: Buffer;
    if (model.providerId === 'vieneu_local') {
      await activeVieNeuRuntime?.ensureReady();
      bytes = await generateVieNeuSpeech({ voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else if (model.providerId === 'elevenlabs' && apiKey !== undefined) {
      bytes = await generateElevenLabsSpeech({ apiKey, modelId: model.id, voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else if (model.providerId === 'openai' && apiKey !== undefined) {
      bytes = await generateOpenAiSpeech({ apiKey, modelId: model.id, voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} speech synthesis adapter is not implemented in this build.`
      };
    }
    await writeFile(outputFilePath, bytes);
    return { ok: true, outputFilePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Speech synthesis failed.' };
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
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage }),
    ...(request.referenceImages === undefined ? {} : { referenceImages: request.referenceImages })
  };
  try {
    let image: GeneratedImage;
    if (model.providerId === 'openai') {
      image = await generateOpenAiImage(synthesisInput);
    } else if (model.providerId === 'google_gemini') {
      image = await generateNanoBananaImage(synthesisInput);
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

/** Resolve only catalog entries with a runnable adapter for the requested domain. */
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
  const providerMapping = getVideoProviderBinding(model.id);
  if (providerMapping === undefined) throw new Error(`Model ${model.id} has no runnable video provider binding.`);
  const provider: VideoGenerationProviderId = providerMapping.seamProviderId;
  const modelId = model.id;
  const resolvedInputs = validateVideoInputSet(request);
  const operation = resolvedInputs.operation;
  const constraints = getVideoOperationConstraints(modelId, operation);
  const durationSeconds = request.durationSeconds ?? constraints?.durationSeconds[0] ?? 4;
  const aspectRatio = request.aspectRatio ?? constraints?.aspectRatios[0] ?? '16:9';
  const mode = request.mode ?? (model.providerId === 'xai' ? 'browser_session' : model.executionPath);
  if (mode === 'browser_session') {
    const flowModel = model.providerId === 'google_gemini' ? googleFlowVideoModelFor(modelId) : null;
    if (model.providerId === 'google_gemini') {
      if (flowModel === null) {
        throw new Error(`${model.label} has no exact counterpart in the current Google Flow video menu. Use the API lane instead.`);
      }
    } else if (!(model.providerId === 'xai' && providerMapping.adapterId === 'grok_imagine_browser')) {
      throw new Error('Browser-session video generation is available only for an explicitly supported Google Flow or Grok Imagine model.');
    }
    if (model.providerId === 'google_gemini') {
      if (!['text_to_video', 'image_to_video', 'reference_to_video', 'start_end'].includes(operation)) {
        throw new Error(`Google Flow browser-session video does not support ${operation}. Use the matching API or local worker.`);
      }
      if (!['16:9', '9:16'].includes(aspectRatio)) {
        throw new Error('Google Flow browser-session video supports only 16:9 or 9:16.');
      }
      if (!googleFlowVideoDurationOptions(flowModel!).includes(durationSeconds)) {
        throw new Error(`${model.label} accepts ${googleFlowVideoDurationOptions(flowModel!).join(', ')} second clips through Google Flow.`);
      }
    }
  }
  if (mode === 'local' && providerMapping.adapterId !== 'comfyui_wan') {
    throw new Error('No local video generation adapter is configured for this model.');
  }
  const validation = validateVideoRequest({
    modelId,
    operation,
    durationSeconds,
    aspectRatio,
    referenceImageCount: resolvedInputs.referenceImageCount
  });
  if (!validation.ok) throw new Error(validation.message);
  const estimate = estimateVideoCost({ modelId, durationSeconds });
  const reservationId = mode === 'api' ? await reserveSpend(estimate, request.acceptUnknownCost) : null;
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const now = new Date().toISOString();

  const job: PersistedVideoGenerationJob = {
    id,
    provider,
    mode,
    status: 'queued',
    prompt: request.prompt,
    operation,
    aspectRatio,
    durationSeconds,
    stylePreset: request.stylePreset ?? 'Cinematic',
    modelId,
    createdAt: now,
    updatedAt: now
  };
  const normalizedRequest: VideoGenerationRequest & { readonly durationSeconds: number } = {
    ...request,
    aspectRatio,
    durationSeconds
  };

  videoJobs.set(id, job);
  try {
    await persistVideoJobs();
  } catch {
    videoJobs.delete(id);
    await settleSpend(reservationId, 'released');
    throw new Error('The video job could not be recorded safely, so it was not submitted.');
  }
  logVideoJob(id, 'request.queued', {
    modelId,
    operation,
    durationSeconds,
    aspectRatio,
    referenceImageCount: resolvedInputs.referenceImageCount,
    executionPath: mode
  });

  setTimeout(async () => {
    const startedAt = Date.now();
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      await persistVideoJobs();
      logVideoJob(id, 'process.started');

      let apiKey = mode === 'api' ? request.apiKey?.trim() : undefined;
      if (mode === 'api' && (!apiKey || apiKey.length === 0) && activeCredentialStore && providerMapping.credentialKey !== undefined) {
        apiKey = await activeCredentialStore.getCredentialValue(providerMapping.credentialKey);
      }

      if (mode === 'api' && (!apiKey || apiKey.length === 0)) {
        throw new Error(`API key is required for ${VIDEO_PROVIDER_LABELS[provider]} cloud generation. Connect the provider in Settings first.`);
      }

      if (mode === 'api') await settleSpend(reservationId, 'charged');
      logVideoJob(id, 'provider.request.started', { provider: VIDEO_PROVIDER_LABELS[provider] });
      let cloudResult: CloudProviderResult;
      if (mode === 'browser_session') {
        if (activeBrowserVideoGenerator === undefined) throw new Error('Signed-in browser-session video generation is unavailable in this runtime.');
        const generated = await activeBrowserVideoGenerator({
          modelId,
          prompt: request.prompt,
          operation,
          aspectRatio,
          durationSeconds,
          ...(request.stylePreset === undefined ? {} : { stylePreset: request.stylePreset }),
          ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage }),
          ...(request.lastFrame === undefined ? {} : { lastFrame: request.lastFrame }),
          ...(request.referenceImages === undefined ? {} : { referenceImages: request.referenceImages }),
          showBrowserWindow: request.showBrowserWindow !== false,
          ...(request.flowProjectName === undefined ? {} : { projectName: request.flowProjectName })
        });
        const outputFilePath = join(videoDir, `${id}.mp4`);
        await writeFile(outputFilePath, generated.bytes);
        cloudResult = { ok: true, outputFilePath, providerJobId: generated.providerJobId };
      } else if (providerMapping.adapterId === 'comfyui_wan') {
        if (!activeAssetSourceResolver || !request.projectId || !request.drivingVideoAssetId || !request.referenceImage || !request.motionMode) {
          throw new Error('Motion Control requires a project, character image, driving video, and Move/Mix mode.');
        }
        const source = await activeAssetSourceResolver(request.projectId, request.drivingVideoAssetId);
        if (source === null) throw new Error('The selected driving video is no longer available in this project.');
        let lastProgressLogMs = -10_000;
        try {
          const generated = await generateComfyUiMotionVideo({
            mode: request.motionMode,
            prompt: request.prompt,
            characterImage: request.referenceImage,
            drivingVideo: source,
            outputFilePath: join(videoDir, `${id}.mp4`),
            onProgress: (stage, elapsedMs) => {
              if (stage === 'generating' && elapsedMs - lastProgressLogMs < 10_000) return;
              lastProgressLogMs = elapsedMs;
              logVideoJob(id, `comfyui.${stage}`, { elapsedSeconds: Math.round(elapsedMs / 1_000) });
            }
          });
          cloudResult = { ok: true, ...generated };
        } catch (error) {
          await source.file.close().catch(() => undefined);
          throw error;
        }
      } else {
        cloudResult = await invokeCloudVideoProvider(id, model, apiKey!, normalizedRequest, join(videoDir, `${id}.mp4`));
      }
      if (!cloudResult.ok) {
        throw new Error(cloudResult.error);
      }

      job.status = 'completed';
      if (cloudResult.outputFilePath !== undefined) {
        job.outputFilePath = cloudResult.outputFilePath;
        job.previewUrl = videoPreviewUrl(job.id);
      }
      if (cloudResult.providerJobId !== undefined) {
        job.providerJobId = cloudResult.providerJobId;
      }

      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      await persistVideoJobsBestEffort(id);
      logVideoJob(id, 'request.completed', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        providerJobId: cloudResult.providerJobId
      });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      const actionRequired = browserGenerationActionFromError(err);
      job.status = actionRequired === undefined ? 'failed' : 'needs_user_action';
      if (actionRequired === undefined) delete job.actionRequired;
      else job.actionRequired = actionRequired;
      job.error = err instanceof Error ? err.message : 'Video generation failed';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      await persistVideoJobsBestEffort(id);
      logVideoJob(id, actionRequired === undefined ? 'request.failed' : 'request.needs_user_action', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        ...(actionRequired === undefined ? { error: job.error } : { actionRequired })
      }, actionRequired === undefined ? 'error' : 'info');
    }
  }, 1000);

  return publicVideoJob(job);
}

export function getVideoGenerationJob(jobId: string): VideoGenerationJob | null {
  const job = videoJobs.get(jobId);
  return job === undefined ? null : publicVideoJob(job);
}

export async function createImageGenerationJob(request: ImageGenerationRequest): Promise<ImageGenerationJob> {
  const model = resolveGenerationModel('image-generation', request.modelId);
  const providerMapping = IMAGE_MODEL_PROVIDERS[model.providerId];
  const provider: ImageGenerationProviderId = providerMapping?.seam ?? 'openai_images';
  const mode = request.mode ?? (model.providerId === 'xai' ? 'browser_session' : 'api');
  if (mode === 'local') {
    throw new Error('No local image generation adapter is configured for this model.');
  }
  if (mode === 'browser_session' && model.providerId !== 'google_gemini' && model.providerId !== 'xai') {
    throw new Error('Browser-session image generation is available only for an explicitly supported Google Flow or Grok Imagine model.');
  }
  // One image per job, which is what this seam creates.
  const estimate = estimateImageCost({ modelId: model.id, imageCount: 1 });
  // A Google Flow subscription/session is not a metered API request in this
  // ledger, so it must not reserve or charge API spend.
  const reservationId = mode === 'api' ? await reserveSpend(estimate, request.acceptUnknownCost) : null;
  const { imageDir } = await ensureAiDirectories();
  const id = `image-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const job: InternalImageGenerationJob = {
    id,
    provider,
    mode,
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
  logImageJob(id, 'request.queued', {
    modelId: model.id,
    provider: IMAGE_PROVIDER_LABELS[provider],
    mode,
    aspectRatio: job.aspectRatio,
    promptCharacters: request.prompt.length,
    referenceCount: request.referenceImages?.length ?? (request.referenceImage === undefined ? 0 : 1)
  });

  setTimeout(async () => {
    const startedAt = Date.now();
    const running: ImageGenerationJob = { ...job, status: 'running', updatedAt: new Date().toISOString() };
    imageJobs.set(id, running);
    logImageJob(id, 'process.started', { mode });
    try {
      let image: GeneratedImage;
      if (mode === 'browser_session') {
        if (activeBrowserImageGenerator === undefined) {
          throw new Error('Signed-in browser-session image generation is unavailable in this runtime.');
        }
        logImageJob(id, 'browser.request.started');
        image = await activeBrowserImageGenerator({
          modelId: model.id,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          showBrowserWindow: request.showBrowserWindow !== false,
          ...(request.flowProjectName === undefined ? {} : { projectName: request.flowProjectName }),
          ...(request.stylePreset === undefined ? {} : { stylePreset: request.stylePreset }),
          ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
          ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage }),
          ...(request.referenceImages === undefined ? {} : { referenceImages: request.referenceImages })
        });
      } else {
        let apiKey = request.apiKey?.trim();
        if ((apiKey === undefined || apiKey.length === 0) && activeCredentialStore) {
          apiKey = await activeCredentialStore.getCredentialValue(providerMapping?.credentialKey ?? 'openaiApiKey');
        }
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(
            `API key is required for ${IMAGE_PROVIDER_LABELS[provider]} image generation. Connect the provider in Settings first.`
          );
        }

        await settleSpend(reservationId, 'charged');
        const result = await invokeCloudImageProvider(model, apiKey, request);
        if (!result.ok) throw new Error(result.error);
        image = result.image;
      }

      const outputFilePath = join(imageDir, `${id}.${imageExtensionFor(image.mimeType)}`);
      await writeFile(outputFilePath, image.bytes);

      imageJobs.set(id, {
        ...running,
        status: 'completed',
        outputFilePath,
        providerJobId: image.providerJobId,
        // Carried inline so the studio can show the result without ever
        // learning a filesystem path.
        previewMimeType: image.mimeType,
        previewBase64: image.bytes.toString('base64'),
        updatedAt: new Date().toISOString()
      });
      logImageJob(id, 'request.completed', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        bytes: image.bytes.length,
        mimeType: image.mimeType
      });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      const actionRequired = browserGenerationActionFromError(err);
      imageJobs.set(id, {
        ...running,
        status: actionRequired === undefined ? 'failed' : 'needs_user_action',
        ...(actionRequired === undefined ? {} : { actionRequired }),
        error: err instanceof Error ? err.message : 'Image generation failed',
        updatedAt: new Date().toISOString()
      });
      logImageJob(id, actionRequired === undefined ? 'request.failed' : 'request.needs_user_action', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        ...(actionRequired === undefined
          ? { error: err instanceof Error ? err.message : 'Image generation failed' }
          : { actionRequired })
      }, actionRequired === undefined ? 'error' : 'info');
    }
  }, 0);

  return publicImageJob(job);
}

export function getImageGenerationJob(jobId: string): ImageGenerationJob | null {
  const job = imageJobs.get(jobId);
  return job === undefined ? null : publicImageJob(job);
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
  let delivery: VoiceDeliverySettings | undefined;
  if (request.delivery !== undefined) {
    const parsedDelivery = parseVoiceDeliverySettings(request.delivery);
    if (parsedDelivery === null) {
      throw new Error('Voice delivery settings are invalid. Review the performance script and controls before retrying.');
    }
    delivery = parsedDelivery;
  }
  const providerRequest: TextToSpeechRequest = {
    ...request,
    ...(delivery === undefined ? {} : { delivery })
  };
  const model = resolveGenerationModel('voice-generation', request.modelId);
  const speechMapping = SPEECH_MODEL_PROVIDERS[model.providerId];
  if (speechMapping === undefined) throw new Error(`Model ${model.id} has no runnable speech provider binding.`);
  const provider: TextToSpeechJob['provider'] = speechMapping.seam;
  const modelId = model.id;
  const reservationId = model.executionPath === 'api'
    ? await reserveSpend(estimateSpeechCost({ modelId }), request.acceptUnknownCost)
    : null;
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const now = new Date().toISOString();

  const job: InternalSpeechGenerationJob = {
    id,
    provider,
    mode: model.executionPath,
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId ?? '',
    modelId,
    createdAt: now,
    updatedAt: now
  };

  speechJobs.set(id, job);
  logSpeechJob(id, 'request.queued', {
    provider: speechMapping.label,
    executionPath: model.executionPath,
    model: modelId,
    scriptCharacters: request.script.length,
    performanceScriptCharacters: delivery?.performanceScript.length ?? request.script.length,
    expressiveDelivery: delivery !== undefined,
    voiceConfigured: Boolean(request.voiceId?.trim())
  });

  setTimeout(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'process.started');

      let apiKey = request.apiKey?.trim();
      if ((!apiKey || apiKey.length === 0) && activeCredentialStore && speechMapping.credentialKey !== undefined) {
        apiKey = await activeCredentialStore.getCredentialValue(speechMapping.credentialKey);
      }

      if (model.executionPath === 'api' && (!apiKey || apiKey.length === 0)) {
        throw new Error(`API key is required for ${speechMapping.label} speech synthesis. Connect the provider in Settings first.`);
      }

      if (model.executionPath === 'api') await settleSpend(reservationId, 'charged');
      logSpeechJob(id, 'provider.request.started', { executionPath: model.executionPath });
      const extension = provider === 'vieneu_local' ? 'wav' : 'mp3';
      const heartbeat = setInterval(() => {
        logSpeechJob(id, 'process.working', { elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000) });
      }, 10_000);
      let result: CloudProviderResult;
      try {
        result = await invokeSpeechProvider(model, apiKey, providerRequest, join(speechDir, `${id}.${extension}`));
      } finally {
        clearInterval(heartbeat);
      }
      if (!result.ok) {
        throw new Error(result.error);
      }

      job.status = 'completed';
      if (result.outputFilePath !== undefined) {
        job.outputFilePath = result.outputFilePath;
        job.previewUrl = speechPreviewUrl(job.id);
      }

      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'request.completed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10 });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Speech synthesis failed';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'request.failed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10, error: job.error }, 'error');
    }
  }, 1000);

  return publicSpeechJob(job);
}

export function getSpeechGenerationJob(jobId: string): TextToSpeechJob | null {
  const job = speechJobs.get(jobId);
  return job === undefined ? null : publicSpeechJob(job);
}

/**
 * Opens a completed speech result for the privileged media protocol.
 * The renderer receives only a job URL; the file path remains in main and is
 * revalidated at playback time in case it was replaced after generation.
 */
async function openCompletedPreviewSource(
  outputFilePath: string,
  outputDirectory: string,
  mimeType: string
): Promise<OpenedAssetPlaybackSource | null> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const directoryBefore = await lstat(outputDirectory);
    if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) return null;
    const outputDirectoryRealPath = await realpath(outputDirectory);
    file = await open(outputFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [openedStats, pathStats, outputRealPath, directoryAfter] = await Promise.all([
      file.stat(),
      lstat(outputFilePath),
      realpath(outputFilePath),
      lstat(outputDirectory)
    ]);
    const valid =
      openedStats.isFile() &&
      openedStats.size > 0 &&
      !pathStats.isSymbolicLink() &&
      pathStats.isFile() &&
      pathStats.dev === openedStats.dev &&
      pathStats.ino === openedStats.ino &&
      isInsideDirectory(outputDirectoryRealPath, outputRealPath) &&
      !directoryAfter.isSymbolicLink() &&
      directoryAfter.isDirectory() &&
      directoryAfter.dev === directoryBefore.dev &&
      directoryAfter.ino === directoryBefore.ino;
    if (!valid) {
      await file.close();
      return null;
    }
    const source = file;
    file = undefined;
    return {
      file: source,
      filePath: outputFilePath,
      byteLength: openedStats.size,
      mimeType
    };
  } catch (error) {
    await file?.close();
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')) return null;
    throw error;
  }
}

export async function openCompletedSpeechPreviewSource(jobId: string): Promise<OpenedAssetPlaybackSource | null> {
  const job = speechJobs.get(jobId);
  if (job === undefined || job.status !== 'completed' || job.outputFilePath === undefined) return null;
  return openCompletedPreviewSource(
    job.outputFilePath,
    join(getAiStorageDir(), 'speech'),
    job.provider === 'vieneu_local' ? 'audio/wav' : 'audio/mpeg'
  );
}

export async function openCompletedVideoPreviewSource(jobId: string): Promise<OpenedAssetPlaybackSource | null> {
  const job = videoJobs.get(jobId);
  if (job === undefined || job.status !== 'completed' || job.outputFilePath === undefined) return null;
  return openCompletedPreviewSource(job.outputFilePath, join(getAiStorageDir(), 'video'), 'video/mp4');
}

export async function listSpeechVoices(modelId: string): Promise<readonly VoiceChoice[]> {
  const model = resolveGenerationModel('voice-generation', modelId);
  const startedAt = Date.now();
  console.info(`[OpenScene][Speech Voices] request.started ${JSON.stringify({ provider: model.providerLabel, model: model.id })}`);
  try {
    if (model.providerId === 'vieneu_local') await activeVieNeuRuntime?.ensureReady();
    const voices = model.providerId === 'vieneu_local' ? await listVieNeuVoices() : voiceChoices(model.providerId);
    console.info(`[OpenScene][Speech Voices] request.completed ${JSON.stringify({ model: model.id, voices: voices.length, elapsedMs: Date.now() - startedAt })}`);
    return voices;
  } catch (error) {
    console.error(`[OpenScene][Speech Voices] request.failed ${JSON.stringify({ model: model.id, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Voice discovery failed.' })}`);
    throw error;
  }
}

export function getCompletedAiSource(jobId: string): { sourcePath: string; displayName: string; kind: 'video' | 'audio' | 'image'; mimeType: string } | null {
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
    const isWav = speechJob.provider === 'vieneu_local';
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.${isWav ? 'wav' : 'mp3'}`,
      kind: 'audio',
      mimeType: isWav ? 'audio/wav' : 'audio/mpeg'
    };
  }

  const imageJob = imageJobs.get(jobId);
  if (imageJob && imageJob.status === 'completed' && imageJob.outputFilePath) {
    const mimeType = imageJob.previewMimeType ?? 'image/png';
    return {
      sourcePath: imageJob.outputFilePath,
      displayName: `AI_Image_${imageJob.id.slice(-6)}.${imageExtensionFor(mimeType)}`,
      kind: 'image',
      mimeType
    };
  }

  return null;
}
