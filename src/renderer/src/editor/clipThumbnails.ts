import { useEffect, useState } from 'react';

import { thumbnailKey, thumbnailTimesMs, type ThumbnailClip } from '../../../shared/clipThumbnails';

/**
 * Frames along a clip on the desktop timeline.
 *
 * Decoded in the renderer with a hidden `<video>` and a canvas rather than by
 * spawning FFmpeg per frame. The asset already has a playback URL — the program
 * monitor plays it — and Chromium is already decoding that file for preview, so
 * this asks the decoder that is running rather than starting a process per
 * thumbnail and paying to re-open the container each time.
 *
 * Which frames are shown comes from `shared/clipThumbnails`, so a project looks
 * the same here as it does on a phone.
 *
 * Best-effort throughout: nothing blocks an edit, nothing throws outward, and a
 * source that will not decode leaves the clip drawn exactly as it was before.
 */

const cache = new Map<string, string>();

/** Enough for a busy timeline without holding a film's worth of data URLs. */
const MAX_CACHED = 200;

/**
 * One decode at a time, and one element per source.
 *
 * A timeline asks for dozens of frames in a single render. Seeking one element
 * repeatedly is far cheaper than opening one per frame, and doing it serially
 * keeps the editor responsive while the strip fills in — which is the right
 * trade for something nobody is waiting on.
 */
let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, dataUrl: string): void {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, dataUrl);
}

/** Resolves when the element has the frame at `atMs` ready to be drawn. */
function seek(video: HTMLVideoElement, atMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      resolve();
    };
    const failed = (): void => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      reject(new Error('seek failed'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', failed);
    video.currentTime = Math.max(0, atMs / 1_000);
  });
}

async function loaded(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.preload = 'auto';
  // Not attached to the document: it is a decoder, not something to look at.
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('load failed')), { once: true });
  });
  return video;
}

/** Height in device pixels. Small: this is a strip a few millimetres tall. */
const FRAME_HEIGHT = 72;

function draw(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.height = FRAME_HEIGHT;
  canvas.width = Math.max(1, Math.round((width / height) * FRAME_HEIGHT));
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  // JPEG: a strip of photographic frames, where PNG would be several times the
  // size for a picture nobody inspects.
  return canvas.toDataURL('image/jpeg', 0.6);
}

function framesFor(assetId: string, url: string, timesMs: readonly number[]): Promise<readonly string[]> {
  const wanted = timesMs.map((atMs) => ({ atMs, key: thumbnailKey(assetId, atMs) }));
  if (wanted.every(({ key }) => cache.has(key))) {
    return Promise.resolve(wanted.map(({ key }) => cache.get(key) as string));
  }

  const work = queue.then(async () => {
    let video: HTMLVideoElement | null = null;
    try {
      const frames: string[] = [];
      for (const { atMs, key } of wanted) {
        const cached = cache.get(key);
        if (cached !== undefined) {
          frames.push(cached);
          continue;
        }
        video ??= await loaded(url);
        await seek(video, atMs);
        const drawn = draw(video);
        if (drawn === null) continue;
        remember(key, drawn);
        frames.push(drawn);
      }
      return frames;
    } catch {
      return [];
    } finally {
      // Dropping the source tells Chromium it may release the decoder.
      if (video !== null) video.src = '';
    }
  });
  queue = work.catch(() => undefined);
  return work;
}

export function useClipThumbnails(input: {
  readonly assetId: string;
  readonly url: string | null;
  readonly clip: ThumbnailClip;
  readonly widthPx: number;
}): readonly string[] {
  const { assetId, url, clip, widthPx } = input;
  const signature = thumbnailTimesMs(clip, widthPx).join(',');
  const [frames, setFrames] = useState<readonly string[]>([]);

  useEffect(() => {
    if (url === null || signature.length === 0) {
      setFrames([]);
      return;
    }
    let live = true;
    void framesFor(assetId, url, signature.split(',').map(Number)).then((decoded) => {
      if (live) setFrames(decoded);
    });
    return () => {
      live = false;
    };
  }, [assetId, signature, url]);

  return frames;
}

/** Test seam: module-level state is deliberate, and deliberate state has to be resettable. */
export function resetClipThumbnailsForTests(): void {
  cache.clear();
  queue = Promise.resolve();
}
