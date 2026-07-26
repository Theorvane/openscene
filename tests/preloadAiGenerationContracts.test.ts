import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const PRELOAD_SOURCE_URL = new URL('../src/preload/index.ts', import.meta.url);

describe('preload AI generation IPC contracts', () => {
  it('exposes shared typed requests and jobs instead of unknown generation payloads', async () => {
    const source = await readFile(PRELOAD_SOURCE_URL, 'utf8');

    expect(source).toContain("import type { TextToSpeechJob, TextToSpeechRequest, VideoGenerationJob, VideoGenerationRequest } from '../shared/providerSeams';");
    expect(source).toContain('aiGenerateVideo(request: VideoGenerationRequest): Promise<ApiResponse<VideoGenerationJob>>;');
    expect(source).toContain('aiGetVideoJob(jobId: string): Promise<ApiResponse<VideoGenerationJob>>;');
    expect(source).toContain('aiGenerateSpeech(request: TextToSpeechRequest): Promise<ApiResponse<TextToSpeechJob>>;');
    expect(source).toContain('aiGetSpeechJob(jobId: string): Promise<ApiResponse<TextToSpeechJob>>;');
  });
});
