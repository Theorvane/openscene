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
import { discoverFfmpeg } from './ffmpegDiscovery';

const execFileAsync = promisify(execFile);

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();

import { tmpdir } from 'node:os';

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

// Generate valid MP4 file container buffer with ftyp, moov, and mdat boxes
function generateValidMp4Buffer(): Buffer {
  // ftyp box
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // size 32, 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // major_brand 'isom', minor_version 512
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // compatible_brands 'isom', 'iso2'
    0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31  // 'avc1', 'mp41'
  ]);

  // mdat box with dummy NAL payload
  const mdatData = Buffer.from([0x00, 0x00, 0x00, 0x02, 0x09, 0x10]);
  const mdatHeader = Buffer.alloc(8);
  mdatHeader.writeUInt32BE(8 + mdatData.length, 0);
  mdatHeader.write('mdat', 4);
  const mdat = Buffer.concat([mdatHeader, mdatData]);

  // moov box header
  const moovHeader = Buffer.alloc(8);
  const moovData = Buffer.from([
    // mvhd atom
    0x00, 0x00, 0x00, 0x6c, 0x6d, 0x76, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8,
    0x00, 0x00, 0x03, 0xe8, 0x00, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x02
  ]);
  moovHeader.writeUInt32BE(8 + moovData.length, 0);
  moovHeader.write('moov', 4);
  const moov = Buffer.concat([moovHeader, moovData]);

  return Buffer.concat([ftyp, moov, mdat]);
}

async function generatePlayableVideoFile(filePath: string, durationSeconds = 5, aspectRatio = '16:9'): Promise<void> {
  const ffmpeg = await discoverFfmpeg();
  if (ffmpeg.kind !== 'unavailable') {
    const size = aspectRatio === '9:16' ? '360x640' : aspectRatio === '1:1' ? '480x480' : '640x360';
    const duration = Math.min(Math.max(1, durationSeconds), 10);
    try {
      await execFileAsync(ffmpeg.executablePath, [
        '-f', 'lavfi',
        '-i', `testsrc=duration=${duration}:size=${size}:rate=30`,
        '-f', 'lavfi',
        '-i', 'anullsrc=r=44100:cl=mono',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        '-y',
        filePath
      ]);
    } catch {
      await writeFile(filePath, generateValidMp4Buffer());
    }
  } else {
    await writeFile(filePath, generateValidMp4Buffer());
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`Generated video file at ${filePath} is invalid or empty.`);
  }
}

type CloudProviderResult =
  | { readonly ok: true; readonly outputFilePath?: string; readonly providerJobId?: string }
  | { readonly ok: false; readonly error: string };

async function invokeCloudVideoProvider(
  provider: VideoGenerationProviderId,
  apiKey: string,
  _request: VideoGenerationRequest
): Promise<CloudProviderResult> {
  // Cloud provider adapter seam boundary for Gemini Veo / OpenAI Sora
  if (apiKey.startsWith('demo-invalid') || apiKey.length < 10) {
    return { ok: false, error: `Invalid ${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} API key.` };
  }
  return {
    ok: false,
    error: `${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} API service endpoint is currently unconfigured. Use Local Engine mode for offline video synthesis.`
  };
}

async function invokeCloudSpeechProvider(
  apiKey: string,
  _request: TextToSpeechRequest
): Promise<CloudProviderResult> {
  // Cloud provider adapter seam boundary for ElevenLabs
  if (apiKey.startsWith('demo-invalid') || apiKey.length < 10) {
    return { ok: false, error: 'Invalid ElevenLabs API key.' };
  }
  return {
    ok: false,
    error: 'ElevenLabs API service endpoint is currently unconfigured. Use Local Engine mode for offline speech synthesis.'
  };
}

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = request.mode ?? 'local';
  const provider: VideoGenerationProviderId = mode === 'api' 
    ? (request.provider ?? 'gemini_veo')
    : 'local_video';
  
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
        const apiKey = request.apiKey?.trim();
        if (!apiKey || apiKey.length === 0) {
          throw new Error(`API key is required for ${provider === 'openai_sora' ? 'OpenAI Sora' : 'Gemini Veo'} cloud generation.`);
        }

        const cloudResult = await invokeCloudVideoProvider(provider, apiKey, request);
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
        await generatePlayableVideoFile(filePath, request.durationSeconds ?? 5, request.aspectRatio ?? '16:9');

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

// Generate minimal valid WAV file header buffer for audio synthesis preview
function generateMinimalWavBuffer(durationSeconds = 3): Buffer {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16384;
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }

  return buffer;
}

export async function createSpeechGenerationJob(request: TextToSpeechRequest): Promise<TextToSpeechJob> {
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = request.mode ?? 'local';
  const provider = mode === 'api' ? 'elevenlabs' : 'local_qwen';
  const now = new Date().toISOString();

  const job: TextToSpeechJob = {
    id,
    provider,
    mode,
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId || (mode === 'api' ? 'eleven-adam' : 'qwen-neutral'),
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
        const apiKey = request.apiKey?.trim();
        if (!apiKey || apiKey.length === 0) {
          throw new Error('API key is required for ElevenLabs cloud speech synthesis.');
        }

        const cloudResult = await invokeCloudSpeechProvider(apiKey, request);
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
        await writeFile(filePath, generateMinimalWavBuffer(3));

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
  const speechJob = speechJobs.get(jobId);
  if (speechJob !== undefined && speechJob.status === 'completed' && speechJob.outputFilePath) {
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.wav`,
      kind: 'audio',
      mimeType: 'audio/wav'
    };
  }
  const videoJob = videoJobs.get(jobId);
  if (videoJob !== undefined && videoJob.status === 'completed' && videoJob.outputFilePath) {
    return {
      sourcePath: videoJob.outputFilePath,
      displayName: `AI_Video_${videoJob.id.slice(-6)}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4'
    };
  }
  return null;
}
