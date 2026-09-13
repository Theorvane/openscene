import type { MotionControlMode } from './comfyUiMotion';

export type VideoGenerationProviderId = 'gemini_veo' | 'gemini_omni' | 'grok_imagine' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream' | 'minimax_hailuo' | 'comfyui_wan';
export type TextToSpeechProviderId = 'elevenlabs' | 'openai_tts' | 'gemini_tts' | 'groq_tts' | 'vieneu_local';
export type ImageGenerationProviderId =
  | 'openai_images'
  /** Kept so image jobs saved by older builds still deserialize. */
  | 'google_imagen'
  | 'google_nano_banana'
  | 'grok_imagine'
  | 'byteplus_seedream'
  | 'stability_image'
  | 'flux_image'
  | 'alibaba_wan_image';
export const BROWSER_GENERATION_ACTIONS = ['sign_in', 'verification', 'rate_limit', 'unavailable'] as const;
export type BrowserGenerationAction = (typeof BROWSER_GENERATION_ACTIONS)[number];
export type ProviderJobStatus = 'queued' | 'running' | 'needs_user_action' | 'completed' | 'failed';
/** Media generation can use a cloud API, an isolated signed-in browser, or a user-managed local runtime. */
export type ProviderExecutionMode = 'api' | 'browser_session' | 'local';

export interface ProviderApiConfig {
  geminiApiKey?: string;
  openaiApiKey?: string;
  runwayApiKey?: string;
  klingApiKey?: string;
  lumaApiKey?: string;
  elevenlabsApiKey?: string;
  bytePlusApiKey?: string;
}

/**
 * Image sizes are expressed as an aspect ratio rather than pixels, because the
 * providers disagree on what they accept: OpenAI takes a WxH string from a
 * fixed set, Nano Banana takes a ratio, and BytePlus takes a "2K"-style bucket.
 * Each adapter maps the ratio onto its own vocabulary.
 */
export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

/** A picked reference image, carried inline so no path reaches the renderer. */
export interface ReferenceImageSelection {
  readonly displayName: string;
  readonly mimeType: string;
  readonly base64: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  /** Project-scoped source used by local motion-control jobs. */
  projectId?: string;
  /** Driving video already imported into the project asset library. */
  drivingVideoAssetId?: string;
  /** Wan Animate movement transfer or character/background replacement. */
  motionMode?: MotionControlMode;
  /** Explicit operation; omitted requests retain legacy text/first-frame inference. */
  operation?: import('./mediaCapabilityRegistry').VideoOperation;
  /** First frame for image-to-video or Start-End generation. */
  referenceImage?: ReferenceImageSelection;
  /** Required ending frame for Start-End generation. */
  lastFrame?: ReferenceImageSelection;
  /** One to three identity/product references for reference-to-video. */
  referenceImages?: readonly ReferenceImageSelection[];
  aspectRatio: VideoAspectRatio;
  /** Omit to use the selected model's first supported duration. */
  durationSeconds?: number;
  stylePreset?: string;
  mode?: ProviderExecutionMode;
  /** Desktop-only observability control for signed-in Google Flow jobs. */
  showBrowserWindow?: boolean;
  /** Desktop-only project/folder label mirrored into Google Flow. */
  flowProjectName?: string;
  provider?: VideoGenerationProviderId;
  modelId?: string;
  apiKey?: string;
  /**
   * Whether the user has accepted a charge nobody can price.
   *
   * Under a spending limit an unpriced model is refused, because a charge that
   * cannot be priced cannot be kept under a ceiling. This is how someone takes
   * it deliberately anyway.
   */
  acceptUnknownCost?: boolean;
}

export interface VideoGenerationJob {
  id: string;
  provider: VideoGenerationProviderId;
  mode: ProviderExecutionMode;
  status: ProviderJobStatus;
  prompt: string;
  /** Present for new jobs; optional so saved jobs from older builds still load. */
  operation?: import('./mediaCapabilityRegistry').VideoOperation;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  stylePreset?: string;
  providerJobId?: string;
  modelId?: string;
  outputAssetId?: string;
  previewUrl?: string;
  /** Why a signed-in browser job stopped without being retried automatically. */
  actionRequired?: BrowserGenerationAction;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoGenerationProvider {
  readonly id: VideoGenerationProviderId;
  readonly label: string;
  readonly mode: ProviderExecutionMode;
  createJob(request: VideoGenerationRequest): Promise<VideoGenerationJob>;
  getJob(jobId: string): Promise<VideoGenerationJob>;
}

export interface TextToSpeechRequest {
  script: string;
  /** Provider-facing delivery text/settings; subtitles continue to use script. */
  delivery?: import('./voiceDelivery').VoiceDeliverySettings;
  voiceId: string;
  modelId?: string;
  language?: string;
  mode?: ProviderExecutionMode;
  apiKey?: string;
  /**
   * Whether the user has accepted a charge nobody can price.
   *
   * Under a spending limit an unpriced model is refused, because a charge that
   * cannot be priced cannot be kept under a ceiling. This is how someone takes
   * it deliberately anyway.
   */
  acceptUnknownCost?: boolean;
}

export interface TextToSpeechJob {
  id: string;
  provider: TextToSpeechProviderId;
  mode: ProviderExecutionMode;
  status: ProviderJobStatus;
  script: string;
  voiceId: string;
  modelId?: string;
  outputAssetId?: string;
  previewUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextToSpeechProvider {
  readonly id: TextToSpeechProviderId;
  readonly label: string;
  readonly mode: ProviderExecutionMode;
  createJob(request: TextToSpeechRequest): Promise<TextToSpeechJob>;
  getJob(jobId: string): Promise<TextToSpeechJob>;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /** Optional image-to-image seed, carried inline like the video reference. */
  referenceImage?: ReferenceImageSelection;
  /** Additional approved references for providers that support multi-image input. */
  referenceImages?: readonly ReferenceImageSelection[];
  stylePreset?: string;
  negativePrompt?: string;
  mode?: ProviderExecutionMode;
  /** Desktop-only observability control for signed-in Google Flow jobs. */
  showBrowserWindow?: boolean;
  /** Desktop-only project/folder label mirrored into Google Flow. */
  flowProjectName?: string;
  provider?: ImageGenerationProviderId;
  modelId?: string;
  apiKey?: string;
  /**
   * Whether the user has accepted a charge nobody can price.
   *
   * Under a spending limit an unpriced model is refused, because a charge that
   * cannot be priced cannot be kept under a ceiling. This is how someone takes
   * it deliberately anyway.
   */
  acceptUnknownCost?: boolean;
}

export interface ImageGenerationJob {
  id: string;
  provider: ImageGenerationProviderId;
  mode: ProviderExecutionMode;
  status: ProviderJobStatus;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  stylePreset?: string;
  negativePrompt?: string;
  providerJobId?: string;
  modelId?: string;
  /** Inline preview so the renderer can show the result without a file path. */
  previewMimeType?: string;
  previewBase64?: string;
  /** Why a signed-in browser job stopped without being retried automatically. */
  actionRequired?: BrowserGenerationAction;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageGenerationProvider {
  readonly id: ImageGenerationProviderId;
  readonly label: string;
  readonly mode: ProviderExecutionMode;
  createJob(request: ImageGenerationRequest): Promise<ImageGenerationJob>;
  getJob(jobId: string): Promise<ImageGenerationJob>;
}
import type { VideoAspectRatio } from './mediaCapabilityRegistry';
