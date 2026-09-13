import { parseGetAssetPlaybackUrlInput } from '../shared/timelineValidators';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { parseAssetByteRange, type AssetByteRange } from './assetByteRange';
import { isOpaqueId } from './projectStoreSupport';

export type MediaPlaybackResolver = {
  openAssetPlaybackSource(projectId: string, assetId: string): Promise<OpenedAssetPlaybackSource | null>;
  openGeneratedSpeechSource?(jobId: string): Promise<OpenedAssetPlaybackSource | null>;
  openGeneratedVideoSource?(jobId: string): Promise<OpenedAssetPlaybackSource | null>;
};

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function rangeNotSatisfiable(fileSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': '0',
      'Content-Range': `bytes */${fileSize}`
    }
  });
}

function responseHeaders(source: OpenedAssetPlaybackSource, range: AssetByteRange | null): Headers {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range?.length ?? source.byteLength),
    'Content-Type': source.mimeType
  });
  if (range !== null) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${source.byteLength}`);
  }
  return headers;
}

function createFileBody(source: OpenedAssetPlaybackSource, range: AssetByteRange | null): ReadableStream<Uint8Array> {
  let position = range?.start ?? 0;
  let remainingBytes = range?.length ?? source.byteLength;
  let fileOpen = true;
  const closeFile = async (): Promise<void> => {
    if (fileOpen) {
      fileOpen = false;
      await source.file.close();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remainingBytes === 0) {
        controller.close();
        await closeFile();
        return;
      }
      const chunk = new Uint8Array(Math.min(64 * 1_024, remainingBytes));
      const result = await source.file.read(chunk, 0, chunk.byteLength, position).catch(async (error: unknown) => {
        await closeFile();
        throw error;
      });
      if (result.bytesRead === 0) {
        controller.error(new Error('Asset file ended before its persisted byte length.'));
        await closeFile();
        return;
      }
      position += result.bytesRead;
      remainingBytes -= result.bytesRead;
      controller.enqueue(chunk.subarray(0, result.bytesRead));
    },
    cancel: closeFile
  });
}

async function streamAssetResponse(request: Request, source: OpenedAssetPlaybackSource): Promise<Response> {
  const parsedRange = parseAssetByteRange(request.headers.get('range'), source.byteLength);
  if (parsedRange.kind === 'invalid') {
    await source.file.close();
    return rangeNotSatisfiable(source.byteLength);
  }
  const range = parsedRange.kind === 'partial' ? parsedRange.range : null;
  const status = range === null ? 200 : 206;
  const headers = responseHeaders(source, range);
  if (request.method === 'HEAD' || source.byteLength === 0) {
    await source.file.close();
    return new Response(null, { status, headers });
  }
  return new Response(createFileBody(source, range), { status, headers });
}

export function createTimelineAssetRequestHandler(
  resolver: MediaPlaybackResolver
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.hostname === 'speech-preview' &&
      segments.length === 1 &&
      segments[0] !== undefined &&
      isOpaqueId(segments[0]) &&
      resolver.openGeneratedSpeechSource !== undefined
    ) {
      const source = await resolver.openGeneratedSpeechSource(segments[0]);
      return source === null ? notFound() : streamAssetResponse(request, source);
    }
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.hostname === 'video-preview' &&
      segments.length === 1 &&
      segments[0] !== undefined &&
      isOpaqueId(segments[0]) &&
      resolver.openGeneratedVideoSource !== undefined
    ) {
      const source = await resolver.openGeneratedVideoSource(segments[0]);
      return source === null ? notFound() : streamAssetResponse(request, source);
    }
    const projectId = segments[0];
    const assetId = segments[1];
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      url.hostname !== 'playback' ||
      projectId === undefined ||
      assetId === undefined ||
      segments.length !== 2
    ) {
      return notFound();
    }
    const input = parseGetAssetPlaybackUrlInput({ projectId, assetId });
    if (input === null) {
      return notFound();
    }
    const source = await resolver.openAssetPlaybackSource(input.projectId, input.assetId);
    return source === null ? notFound() : streamAssetResponse(request, source);
  };
}
