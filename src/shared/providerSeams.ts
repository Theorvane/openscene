export type VideoGenerationProviderId = 'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream' | 'local_video';
export type TextToSpeechProviderId = 'elevenlabs' | 'local_qwen';
export type ProviderJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ProviderExecutionMode = 'local' | 'api';

export interface ProviderApiConfig {
  geminiApiKey?: string;
  openaiApiKey?: string;
  runwayApiKey?: string;
  klingApiKey?: string;
  lumaApiKey?: string;
  elevenlabsApiKey?: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  stylePreset?: string;
  mode?: ProviderExecutionMode;
  provider?: VideoGenerationProviderId;
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
