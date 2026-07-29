import { describe, expect, it, vi } from 'vitest';

import {
  generateElevenLabsSpeech,
  generateOpenAiSpeech,
  generateSoraVideo,
  generateVeoVideo
} from '../src/main/mediaGenerationAdapters';

const AUDIO_BYTES = new Uint8Array([1, 2, 3]).buffer;
const VIDEO_BYTES = new Uint8Array([9, 8, 7, 6]).buffer;

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
      modelId: 'veo-3.0-generate-001',
      prompt: 'A sunrise over Seoul',
      aspectRatio: '16:9',
      durationSeconds: 5,
      pollIntervalMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(calls[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning');
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
        // 10s snaps to Sora's nearest allowed clip length.
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
      durationSeconds: 10,
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
