import { describe, expect, it, vi } from 'vitest';

import {
  requestLumaVideo,
  requestRunwayVideo,
  requestSoraVideo,
  requestVeoVideo,
  snapSoraSeconds,
  supportsReferenceImage,
  videoAdapterFor
} from '../src/shared/videoGeneration';

/**
 * These cover the half of video generation that both hosts share: the request,
 * the polling, and where the finished video is fetched from. The download itself
 * is deliberately not part of it — the desktop reads bytes into a Buffer and the
 * phone streams to disk natively, so there is nothing common left to test.
 */

describe('shared video generation', () => {
  it('polls Veo until done and reports the sample URI with the key in a header', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(url).not.toContain('gemini-key');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
      if (url.endsWith(':predictLongRunning')) {
        return new Response(JSON.stringify({ name: 'operations/abc' }), { status: 200 });
      }
      // First poll is unfinished, so a caller that stops at the first response
      // would be caught here rather than in production.
      if (calls.filter((entry) => entry.endsWith('operations/abc')).length === 1) {
        return new Response(JSON.stringify({ done: false }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files/clip.mp4' } }] } }
        }),
        { status: 200 }
      );
    });

    const ready = await requestVeoVideo({
      apiKey: 'gemini-key',
      modelId: 'veo-3.0-generate-001',
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
      durationSeconds: 8,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(ready.url).toBe('https://files/clip.mp4');
    expect(ready.providerJobId).toBe('operations/abc');
    expect(ready.headers).toEqual({ 'x-goog-api-key': 'gemini-key' });
  });

  it('rejects a square Veo request before contacting the provider', async () => {
    const fetchMock = vi.fn();
    await expect(requestVeoVideo({
      apiKey: 'k',
      modelId: 'veo-3.0-generate-001',
      prompt: 'p',
      aspectRatio: '1:1',
      durationSeconds: 8,
      fetchImpl: fetchMock as unknown as typeof fetch
    })).rejects.toThrow(/accepts 16:9/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an accepted Sora length unchanged and points at the content URL', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.openai.com/v1/videos') {
        const body = JSON.parse(init.body as string);
        expect(body.seconds).toBe('8');
        expect(body.size).toBe('1280x720');
        return new Response(JSON.stringify({ id: 'video_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
    });

    const ready = await requestSoraVideo({
      apiKey: 'sk-test',
      modelId: 'sora-2',
      prompt: 'p',
      aspectRatio: '16:9',
      durationSeconds: 8,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(ready.url).toBe('https://api.openai.com/v1/videos/video_1/content');
    expect(ready.headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  it('rejects an illegal Sora duration before contacting the provider', async () => {
    const fetchMock = vi.fn();
    await expect(requestSoraVideo({
      apiKey: 'sk-test', modelId: 'sora-2', prompt: 'p', aspectRatio: '16:9', durationSeconds: 9,
      fetchImpl: fetchMock as unknown as typeof fetch
    })).rejects.toThrow(/accepts 4, 8, 12 second/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a provider-side failure instead of returning an unusable job', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://api.openai.com/v1/videos'
        ? new Response(JSON.stringify({ id: 'video_2' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'failed', error: { message: 'content policy' } }), { status: 200 })
    );

    await expect(
      requestSoraVideo({
        apiKey: 'sk-test',
        modelId: 'sora-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/content policy/);
  });

  it('never echoes the key when a provider rejects it', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      requestVeoVideo({
        apiKey: 'secret-key-value',
        modelId: 'veo-3.0-generate-001',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/rejected the stored API key/);

    await expect(
      requestVeoVideo({
        apiKey: 'secret-key-value',
        modelId: 'veo-3.0-generate-001',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.not.toThrow(/secret-key-value/);
  });

  it('refuses a Sora reference image rather than dropping it silently', async () => {
    await expect(
      requestSoraVideo({
        apiKey: 'sk-test',
        modelId: 'sora-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        referenceImage: { mimeType: 'image/png', base64: 'AAA' }
      })
    ).rejects.toThrow(/does not implement that request path/);
  });

  it('snaps only to lengths the shared table publishes', () => {
    expect(snapSoraSeconds(9)).toBe(8);
    expect(snapSoraSeconds(11)).toBe(12);
    expect(snapSoraSeconds(1)).toBe(4);
  });

  it('resolves an adapter only for providers that actually have one', () => {
    expect(videoAdapterFor('openai')).toBe(requestSoraVideo);
    expect(videoAdapterFor('google_gemini')).toBe(requestVeoVideo);
    expect(videoAdapterFor('runway')).toBe(requestRunwayVideo);
    expect(videoAdapterFor('luma')).toBe(requestLumaVideo);
    // Listed in the catalog but unported: callers must get undefined and say so
    // rather than picking a wrong adapter.
    expect(videoAdapterFor('kling')).toBeUndefined();
    expect(videoAdapterFor('byteplus')).toBeUndefined();
  });

  it('pins the Runway API version and polls the task until it succeeds', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      // Runway's behaviour is versioned by date; without the header the API
      // silently picks a default that can change under us.
      expect(headers['X-Runway-Version']).toBe('2024-11-06');
      expect(headers.Authorization).toBe('Bearer rw-key');
      if (url === 'https://api.dev.runwayml.com/v1/text_to_video') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ model: 'gen4.5', promptText: 'a kite', ratio: '1280:720', duration: 5 });
        return new Response(JSON.stringify({ id: 'task_1' }), { status: 200 });
      }
      polls += 1;
      return polls === 1
        ? new Response(JSON.stringify({ status: 'RUNNING' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'SUCCEEDED', output: ['https://cdn/out.mp4?_jwt=x'] }), { status: 200 });
    });

    const ready = await requestRunwayVideo({
      apiKey: 'rw-key',
      modelId: 'gen4.5',
      prompt: 'a kite',
      aspectRatio: '16:9',
      durationSeconds: 5,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(ready.url).toBe('https://cdn/out.mp4?_jwt=x');
    // The output URL is already signed, so re-sending the key would leak it to
    // a CDN that never needed it.
    expect(ready.headers).toEqual({});
    expect(ready.providerJobId).toBe('task_1');
  });

  it('rejects a square Runway request before contacting the provider', async () => {
    const fetchMock = vi.fn();
    await expect(requestRunwayVideo({
      apiKey: 'k',
      modelId: 'gen4.5',
      prompt: 'p',
      aspectRatio: '1:1',
      durationSeconds: 5,
      fetchImpl: fetchMock as unknown as typeof fetch
    })).rejects.toThrow(/accepts 16:9 or 9:16/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a cancelled Runway task as a failure, not a silent success', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/text_to_video')
        ? new Response(JSON.stringify({ id: 't' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'CANCELED', failure: 'moderation' }), { status: 200 })
    );
    await expect(
      requestRunwayVideo({
        apiKey: 'k',
        modelId: 'gen4.5',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 5,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/canceled: moderation/);
  });

  it('sends Luma its two legal durations as strings and reads assets.video', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/generations')) {
        const body = JSON.parse(init.body as string);
        seen.push(body.duration);
        expect(body).toMatchObject({ model: 'ray-2', resolution: '720p', aspect_ratio: '9:16' });
        return new Response(JSON.stringify({ id: 'gen_1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ state: 'completed', assets: { video: 'https://cdn-luma/v.mp4' } }),
        { status: 200 }
      );
    });

    const run = (durationSeconds: number) =>
      requestLumaVideo({
        apiKey: 'luma-key',
        modelId: 'ray-2',
        prompt: 'p',
        aspectRatio: '9:16',
        durationSeconds,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      });

    const ready = await run(5);
    await run(9);
    // Dream Machine accepts "5s" or "9s" and nothing else, so a request has to
    // land on one of them rather than passing the number through.
    expect(seen).toEqual(['5s', '9s']);
    expect(ready.url).toBe('https://cdn-luma/v.mp4');
  });

  it('surfaces a Luma failure reason', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/generations')
        ? new Response(JSON.stringify({ id: 'g' }), { status: 200 })
        : new Response(JSON.stringify({ state: 'failed', failure_reason: 'unsafe prompt' }), { status: 200 })
    );
    await expect(
      requestLumaVideo({
        apiKey: 'k',
        modelId: 'ray-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 5,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/unsafe prompt/);
  });

  it('sends a Runway start frame to image_to_video as a data URI', async () => {
    let seenUrl = '';
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('_to_video')) {
        seenUrl = url;
        const body = JSON.parse(init.body as string);
        // A start frame changes the endpoint, not just the body.
        expect(body.promptImage).toBe('data:image/jpeg;base64,QUJD');
        return new Response(JSON.stringify({ id: 't' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'SUCCEEDED', output: ['https://cdn/a.mp4'] }), { status: 200 });
    });

    await requestRunwayVideo({
      apiKey: 'k',
      modelId: 'gen4.5',
      prompt: 'continue',
      aspectRatio: '16:9',
      durationSeconds: 5,
      referenceImage: { mimeType: 'image/jpeg', base64: 'QUJD' },
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(seenUrl).toBe('https://api.dev.runwayml.com/v1/image_to_video');
  });

  it('still uses text_to_video when there is no start frame', async () => {
    let seenUrl = '';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('_to_video')) {
        seenUrl = url;
        return new Response(JSON.stringify({ id: 't' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'SUCCEEDED', output: ['https://cdn/a.mp4'] }), { status: 200 });
    });
    await requestRunwayVideo({
      apiKey: 'k',
      modelId: 'gen4.5',
      prompt: 'p',
      aspectRatio: '16:9',
      durationSeconds: 5,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    expect(seenUrl).toBe('https://api.dev.runwayml.com/v1/text_to_video');
  });

  it('refuses a Luma start frame rather than generating an unrelated shot', async () => {
    await expect(
      requestLumaVideo({
        apiKey: 'k',
        modelId: 'ray-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 5,
        referenceImage: { mimeType: 'image/jpeg', base64: 'QUJD' }
      })
    ).rejects.toThrow(/does not implement that request path/);
  });

  it('claims continuity only where a frame can actually be sent', () => {
    expect(supportsReferenceImage('google_gemini')).toBe(true);
    expect(supportsReferenceImage('runway')).toBe(true);
    // Sora's reference input is multipart this adapter does not send, and Luma's
    // needs a hosted URL. Claiming either would drop the frame silently and
    // produce a cut that does not match.
    expect(supportsReferenceImage('openai')).toBe(false);
    expect(supportsReferenceImage('luma')).toBe(false);
  });
});
