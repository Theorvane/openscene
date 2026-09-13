import { describe, expect, it, vi } from 'vitest';

import {
  generateElevenLabsSpeech,
  generateOpenAiSpeech,
  generateSoraVideo,
  generateVeoVideo,
  generateVieNeuSpeech,
  listVieNeuVoices,
  repairStreamingWavHeader,
  resolveVieNeuBaseUrl
} from '../src/main/mediaGenerationAdapters';
import { createVoiceDeliverySettings } from '../src/shared/voiceDelivery';

const AUDIO_BYTES = new Uint8Array([1, 2, 3]).buffer;
const VIDEO_BYTES = new Uint8Array([9, 8, 7, 6]).buffer;

function streamingWavBytes(): Buffer {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(0xffffffff, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48_000, 24);
  bytes.writeUInt32LE(96_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(1_000_000_000, 40);
  bytes.writeInt16LE(120, 44);
  bytes.writeInt16LE(-120, 46);
  return bytes;
}

describe('media generation adapters', () => {
  it('sends ElevenLabs synthesis with the key in a header and the model in the body', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128');
      expect(url).not.toContain('xi-test-key');
      expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi-test-key');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ text: 'Hello world', model_id: 'eleven_multilingual_v2' });
      return new Response(AUDIO_BYTES, { status: 200 });
    });

    const bytes = await generateElevenLabsSpeech({
      apiKey: 'xi-test-key',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice-123',
      script: 'Hello world',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('sends Eleven v3 audio tags and only its supported stability setting', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        text: '[whispers] Keep this quiet.',
        model_id: 'eleven_v3',
        voice_settings: { stability: 0.3 }
      });
      return new Response(AUDIO_BYTES, { status: 200 });
    });

    await generateElevenLabsSpeech({
      apiKey: 'xi-test-key', modelId: 'eleven_v3', voiceId: 'voice-123', script: 'Keep this quiet.',
      delivery: createVoiceDeliverySettings('[whispers] Keep this quiet.', { stability: 0.3, similarityBoost: 0.1, style: 0.9, speed: 1.2, speakerBoost: false }),
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });

  it('sends supported advanced voice settings to ElevenLabs v2 models', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        text: 'Wait. <break time="0.5s" /> Continue.',
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: false, speed: 0.9 }
      });
      return new Response(AUDIO_BYTES, { status: 200 });
    });

    await generateElevenLabsSpeech({
      apiKey: 'xi-test-key', modelId: 'eleven_multilingual_v2', voiceId: 'voice-123', script: 'Wait. Continue.',
      delivery: createVoiceDeliverySettings('Wait. <break time="0.5s" /> Continue.', { stability: 0.4, similarityBoost: 0.8, style: 0.35, speed: 0.9, speakerBoost: false }),
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });

  it('sends OpenAI speech with a bearer key and falls back to a valid voice', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/speech');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ model: 'gpt-4o-mini-tts', input: 'Hi there', voice: 'alloy', response_format: 'mp3' });
      return new Response(AUDIO_BYTES, { status: 200 });
    });

    await generateOpenAiSpeech({
      apiKey: 'sk-test',
      modelId: 'gpt-4o-mini-tts',
      voiceId: 'not-an-openai-voice',
      script: 'Hi there',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discovers VieNeu voices from the loopback runtime without a key', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8001/voices');
      expect(init).toEqual({ method: 'GET', signal: expect.any(AbortSignal) });
      return new Response(JSON.stringify([{ id: 'voice-north', name: 'Giọng Bắc' }]), { status: 200 });
    });

    await expect(listVieNeuVoices({ fetchImpl: fetchMock as unknown as typeof fetch })).resolves.toEqual([
      { id: 'voice-north', label: 'Giọng Bắc', description: 'VieNeu v3 Turbo preset' }
    ]);
  });

  it('creates VieNeu speech and repairs the streaming WAV lengths for editor import', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:9001/stream');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ text: 'Xin chào', voice_id: 'voice-south' });
      return new Response(new Uint8Array(streamingWavBytes()), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    });

    const bytes = await generateVieNeuSpeech({
      baseUrl: 'http://localhost:9001',
      voiceId: 'voice-south',
      script: 'Xin chào',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  });

  it('sends VieNeu supported inline cues as text without invented style fields', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ text: '[cười] Xin chào', voice_id: 'voice-south' });
      return new Response(new Uint8Array(streamingWavBytes()), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    });

    await generateVieNeuSpeech({
      voiceId: 'voice-south', script: 'Xin chào',
      delivery: createVoiceDeliverySettings('[cười] Xin chào', { stability: 0.1, style: 1 }),
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });

  it('rejects non-loopback VieNeu endpoints and malformed WAV responses', () => {
    expect(() => resolveVieNeuBaseUrl('https://example.com:8001')).toThrow(/loopback|localhost/);
    expect(() => resolveVieNeuBaseUrl('http://127.0.0.1:8001/private')).toThrow(/loopback|localhost/);
    expect(() => repairStreamingWavHeader(Buffer.from('not audio'))).toThrow(/not a WAV/);
  });

  it('drives Veo through predictLongRunning, operation polling, and the video download', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
      expect(url).not.toContain('AIza-test');
      if (url.endsWith(':predictLongRunning')) {
        return new Response(JSON.stringify({ name: 'operations/op-1' }), { status: 200 });
      }
      if (url.endsWith('operations/op-1')) {
        return new Response(
          JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/download/v1' } }] } } }),
          { status: 200 }
        );
      }
      return new Response(VIDEO_BYTES, { status: 200 });
    });

    const generated = await generateVeoVideo({
      apiKey: 'AIza-test',
      modelId: 'veo-3.1-generate-preview',
      prompt: 'A sunrise over Seoul',
      aspectRatio: '16:9',
      durationSeconds: 8,
      pollIntervalMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(calls[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning');
    expect([...generated.bytes]).toEqual([9, 8, 7, 6]);
    expect(generated.providerJobId).toBe('operations/op-1');
  });

  it('drives Sora through job creation, status polling, and the content download', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-sora');
      if (url === 'https://api.openai.com/v1/videos' && init.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('sora-2');
        expect(body.size).toBe('1280x720');
        // The validated duration is sent unchanged.
        expect(body.seconds).toBe('8');
        return new Response(JSON.stringify({ id: 'video_abc' }), { status: 200 });
      }
      if (url === 'https://api.openai.com/v1/videos/video_abc') {
        polls += 1;
        return new Response(JSON.stringify({ status: polls < 2 ? 'in_progress' : 'completed' }), { status: 200 });
      }
      expect(url).toBe('https://api.openai.com/v1/videos/video_abc/content');
      return new Response(VIDEO_BYTES, { status: 200 });
    });

    const generated = await generateSoraVideo({
      apiKey: 'sk-sora',
      modelId: 'sora-2',
      prompt: 'A neon city timelapse',
      aspectRatio: '16:9',
      durationSeconds: 8,
      pollIntervalMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(polls).toBe(2);
    expect([...generated.bytes]).toEqual([9, 8, 7, 6]);
    expect(generated.providerJobId).toBe('video_abc');
  });

  it('reports rejected keys with a reconnect hint and never echoes key material', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));

    await expect(
      generateElevenLabsSpeech({
        apiKey: 'xi-secret-material',
        modelId: 'eleven_v3',
        voiceId: '',
        script: 'Hi',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/rejected the stored API key.*Reconnect the provider in Settings/);

    await expect(
      generateElevenLabsSpeech({
        apiKey: 'xi-secret-material',
        modelId: 'eleven_v3',
        voiceId: '',
        script: 'Hi',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.not.toThrow(/xi-secret-material/);
  });
});
