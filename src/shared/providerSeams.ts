export type VideoGenerationProviderId = 'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream' | 'minimax_hailuo';
export type TextToSpeechProviderId = 'elevenlabs' | 'openai_tts' | 'gemini_tts' | 'groq_tts';
export type ImageGenerationProviderId =
  | 'openai_images'
  | 'google_imagen'
  | 'byteplus_seedream'
  | 'stability_image'
  | 'flux_image'
  | 'alibaba_wan_image';
export type ProviderJobStatus = 'queued' | 'running' | 'completed' | 'failed';
/** Media generation runs against cloud provider APIs; Ollama is the only local engine and serves chat, not media. */
export type ProviderExecutionMode = 'api';

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
 * fixed set, Imagen takes a ratio, and BytePlus takes a "2K"-style bucket.
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
  /** Optional image-to-video seed. */
  referenceImage?: ReferenceImageSelection;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  stylePreset?: string;
  mode?: ProviderExecutionMode;
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
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  stylePreset?: string;
  providerJobId?: string;
  modelId?: string;
  outputAssetId?: string;
  outputFilePath?: string;
  previewUrl?: string;
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
  outputFilePath?: string;
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
  stylePreset?: string;
  negativePrompt?: string;
  mode?: ProviderExecutionMode;
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
  outputFilePath?: string;
  /** Inline preview so the renderer can show the result without a file path. */
  previewMimeType?: string;
  previewBase64?: string;
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
