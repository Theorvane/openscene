import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  TextToSpeechJob,
  TextToSpeechRequest,
  VideoGenerationJob,
  VideoGenerationRequest
} from '../shared/providerSeams';

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();

function getAiStorageDir(): string {
  return join(app.getPath('userData'), 'ai_generations');
}

export async function ensureAiDirectories(): Promise<{ videoDir: string; speechDir: string }> {
  const baseDir = getAiStorageDir();
  const videoDir = join(baseDir, 'video');
  const speechDir = join(baseDir, 'speech');
  await mkdir(videoDir, { recursive: true });
  await mkdir(speechDir, { recursive: true });
  return { videoDir, speechDir };
}

// Generate minimal valid MP4 file header buffer for realistic local preview
function generateMinimalMp4Buffer(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, // ftyp
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31
  ]);
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

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const provider = request.mode === 'api' 
    ? (request.prompt.toLowerCase().includes('sora') ? 'openai_sora' : 'gemini_veo')
    : 'local_video';
  
  const mode = request.mode ?? 'local';
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

      const fileName = `${id}.mp4`;
      const filePath = join(videoDir, fileName);

      await writeFile(filePath, generateMinimalMp4Buffer());

      job.status = 'completed';
      job.outputFilePath = filePath;
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Video generation failed';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
    }
  }, 1200);

  return job;
}

export function getVideoGenerationJob(jobId: string): VideoGenerationJob | null {
  return videoJobs.get(jobId) ?? null;
}

export async function createSpeechGenerationJob(request: TextToSpeechRequest): Promise<TextToSpeechJob> {
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const provider = request.mode === 'api' ? 'elevenlabs' : 'local_qwen';
  const mode = request.mode ?? 'local';
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

      const fileName = `${id}.wav`;
      const filePath = join(speechDir, fileName);

      await writeFile(filePath, generateMinimalWavBuffer(3));

      job.status = 'completed';
      job.outputFilePath = filePath;
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
