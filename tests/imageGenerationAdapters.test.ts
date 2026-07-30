import { describe, expect, it, vi } from 'vitest';

import {
  bytePlusSizeFor,
  generateBytePlusImage,
  generateImagenImage,
  generateOpenAiImage,
  imageExtensionFor,
  openAiSizeFor
} from '../src/main/imageGenerationAdapters';

const PNG_BASE64 = Buffer.from([1, 2, 3, 4]).toString('base64');

describe('image size mapping', () => {
  it('maps every ratio onto a size the provider actually accepts', () => {
    // OpenAI rejects anything outside its fixed set, so a ratio it has no
    // literal size for has to land on the nearest one rather than be passed on.
    expect(openAiSizeFor('1:1')).toBe('1024x1024');
    expect(openAiSizeFor('16:9')).toBe('1536x1024');
    expect(openAiSizeFor('4:3')).toBe('1536x1024');
    expect(openAiSizeFor('9:16')).toBe('1024x1536');
    expect(openAiSizeFor('3:4')).toBe('1024x1536');

    expect(bytePlusSizeFor('16:9')).toBe('2048x1152');
    expect(bytePlusSizeFor('9:16')).toBe('1152x2048');
    expect(bytePlusSizeFor('1:1')).toBe('2048x2048');
  });

  it('names the file after what the provider actually returned', () => {
    expect(imageExtensionFor('image/png')).toBe('png');
    expect(imageExtensionFor('image/jpeg')).toBe('jpg');
    expect(imageExtensionFor('image/webp')).toBe('webp');
    expect(imageExtensionFor('application/octet-stream')).toBe('png');
  });
});

describe('OpenAI image adapter', () => {
  it('sends a bearer key and asks dall-e for base64 explicitly', async () => {
    // dall-e defaults to returning a URL; without response_format the adapter
    // would take the slow path through a second request every time.
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      expect(url).not.toContain('sk-test');
      expect(JSON.parse(init.body as string)).toEqual({
        model: 'dall-e-3',
        prompt: 'a lighthouse',
        size: '1536x1024',
        n: 1,
        response_format: 'b64_json'
      });
      return new Response(JSON.stringify({ created: 7, data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    });

    const result = await generateOpenAiImage({
      apiKey: 'sk-test',
      modelId: 'dall-e-3',
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
    expect(result.mimeType).toBe('image/png');
  });

  it('omits response_format for gpt-image-1, which rejects it', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).not.toHaveProperty('response_format');
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    });

    await generateOpenAiImage({
      apiKey: 'sk-test',
      modelId: 'gpt-image-1',
      prompt: 'a lighthouse',
      aspectRatio: '1:1',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a returned URL instead of failing when bytes are absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/image.png' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([5, 6]).buffer, { status: 200, headers: { 'content-type': 'image/png' } })
      );

    const result = await generateOpenAiImage({
      apiKey: 'sk-test',
      modelId: 'dall-e-3',
      prompt: 'x',
      aspectRatio: '1:1',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect([...result.bytes]).toEqual([5, 6]);
  });

  it('reports the provider status and body rather than a bare failure', async () => {
    const fetchMock = vi.fn(async () => new Response('content policy violation', { status: 400 }));

    await expect(
      generateOpenAiImage({
        apiKey: 'sk-test',
        modelId: 'gpt-image-1',
        prompt: 'x',
        aspectRatio: '1:1',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/OpenAI Images returned 400: content policy violation/);
  });

  it('refuses an empty payload instead of writing a zero-byte image', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: '' }] }), { status: 200 }));

    await expect(
      generateOpenAiImage({
        apiKey: 'sk-test',
        modelId: 'gpt-image-1',
        prompt: 'x',
        aspectRatio: '1:1',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/empty image payload/);
  });
});

describe('Google Imagen adapter', () => {
  it('carries the key in a header and the ratio as a ratio', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict');
      // A key in the query string ends up in logs and in echoed error text.
      expect(url).not.toContain('gemini-key');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
      expect(JSON.parse(init.body as string)).toEqual({
        instances: [{ prompt: 'a harbour' }],
        parameters: { sampleCount: 1, aspectRatio: '9:16', negativePrompt: 'blurry' }
      });
      return new Response(
        JSON.stringify({ predictions: [{ bytesBase64Encoded: PNG_BASE64, mimeType: 'image/jpeg' }] }),
        { status: 200 }
      );
    });

    const result = await generateImagenImage({
      apiKey: 'gemini-key',
      modelId: 'imagen-4.0-generate-001',
      prompt: 'a harbour',
      aspectRatio: '9:16',
      negativePrompt: 'blurry',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.mimeType).toBe('image/jpeg');
    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('omits negativePrompt entirely when there is none', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).parameters).not.toHaveProperty('negativePrompt');
      return new Response(JSON.stringify({ predictions: [{ bytesBase64Encoded: PNG_BASE64 }] }), { status: 200 });
    });

    await generateImagenImage({
      apiKey: 'k',
      modelId: 'imagen-4.0-generate-001',
      prompt: 'x',
      aspectRatio: '1:1',
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });
});

describe('BytePlus Seedream adapter', () => {
  it('sends the ModelArk payload with the watermark off', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ark-key');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('seedream-4-0-250828');
      expect(body.size).toBe('2048x1152');
      expect(body.response_format).toBe('b64_json');
      // A burned-in watermark would survive every downstream edit and export.
      expect(body.watermark).toBe(false);
      expect(body).not.toHaveProperty('image');
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    });

    const result = await generateBytePlusImage({
      apiKey: 'ark-key',
      modelId: 'seedream-4-0-250828',
      prompt: 'a night market',
      aspectRatio: '16:9',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('passes a reference image as a data URL for image-to-image', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).image).toBe('data:image/png;base64,QUJD');
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    });

    await generateBytePlusImage({
      apiKey: 'ark-key',
      modelId: 'seedream-4-0-250828',
      prompt: 'restyle this',
      aspectRatio: '1:1',
      referenceImage: { displayName: 'seed.png', mimeType: 'image/png', base64: 'QUJD' },
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });

  it('reaches a different region when the base URL is overridden', async () => {
    // Mainland Volcengine Ark speaks the same protocol on a different host.
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    });

    await generateBytePlusImage({
      apiKey: 'ark-key',
      modelId: 'seedream-4-0-250828',
      prompt: 'x',
      aspectRatio: '1:1',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });
});
