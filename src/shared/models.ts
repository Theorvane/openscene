import type { TextToSpeechProviderId } from './providerSeams';

export type AppErrorCode =
  | 'SOURCE_STALE'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNAVAILABLE'
  | 'PROFILE_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'TTS_UNAVAILABLE'
  | 'TTS_RESULT_UNAVAILABLE' | 'EXPORT_RESULT_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'RECORDER_UNAVAILABLE' | 'EXPORT_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'FILE_WRITE_FAILED'
  | 'UNKNOWN_ERROR';

export interface AppError {
  code: AppErrorCode;
  message: string;
}

export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface CaptureSource {
  id: string;
  name: string;
  appName: string;
  generation: number;
  thumbnailDataUrl?: string;
  displayId?: string;
}

export type RecordingStatus = 'idle' | 'source_selected' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'error';

export interface RecordingSession {
  id: string;
  sourceId: string;
  sourceName: string;
  status: Exclude<RecordingStatus, 'idle' | 'source_selected' | 'completed' | 'error'>;
  startedAt: string;
  outputPath: string;
}

export interface RecordingResult {
  sessionId: string;
  outputPath: string;
  fileName: string;
  directory: string;
  fileSizeBytes: number;
  durationMs: number;
  createdAt: string;
}

export interface AppSettings {
  recordingsPath: string;
  screenPermission: string;
  platform: NodeJS.Platform;
}

export interface SelectSourceInput {
  sourceId: string;
  generation: number;
}

export interface StartRecordingInput {
  sourceId: string;
  generation: number;
}

export interface AppendRecordingChunkInput {
  sessionId: string;
  sequence: number;
  chunk: ArrayBuffer;
}

export interface FinishRecordingInput {
  sessionId: string;
  durationMs: number;
}

export interface AbortRecordingInput {
  sessionId: string;
  reason: string;
}

export interface ResultActionInput {
  sessionId: string;
}

export interface SourceAvailabilityInput {
  sessionId: string;
}

export interface ChunkAck {
  sequence: number;
  totalBytes: number;
}

export interface SourceAvailability {
  available: boolean;
  reason?: string;
}

export const ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/wav', 'audio/mpeg'] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];


export type GeneratedAudioAssetMetadata = {
  readonly id: string;
  readonly jobId: string;
  readonly voiceProfileId: string;
  readonly provider: TextToSpeechProviderId;
  readonly modelId: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly byteLength: number;
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly channelCount: number;
  readonly language: string;
  readonly createdAt: string;
};
