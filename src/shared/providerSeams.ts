export type VideoGenerationProviderId = 'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream' | 'minimax_hailuo';
export type TextToSpeechProviderId = 'elevenlabs' | 'openai_tts' | 'gemini_tts' | 'groq_tts';
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
}

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
