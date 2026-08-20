import { useEffect, useState } from 'react';

import { thumbnailKey, thumbnailTimesMs, type ThumbnailClip } from '@openvideo/shared/clipThumbnails';
import VideoExport from '../../modules/video-export';

/**
 * Frames along a clip, decoded once and remembered.
 *
 * Best-effort throughout. A thumbnail is a nicety and must never cost an edit:
 * nothing here blocks, nothing throws outward, and a source that will not decode
 * simply leaves the clip looking exactly as it did before thumbnails existed.
 *
 * The cache is module-level rather than component state on purpose. A clip is
 * unmounted and remounted every time the lanes scroll it out of view, and a
 * per-component cache would decode the same second of the same file over and
 * over — which on a phone is measured in dropped frames and battery.
 */

const cache = new Map<string, string>();

/** Enough for a long timeline, small enough that a phone is not holding a film in memory. */
const MAX_CACHED = 240;

/**
 * Decodes run one at a time.
 *
 * A screen full of clips asks for dozens of frames in the same render, and
 * firing them all at once at the platform decoder is how a timeline turns into
 * a slideshow while it stutters through them. A queue makes it slower to fill
 * and keeps the app responsive while it does, which is the right trade for
 * something nobody is waiting on.
 */
let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, uri: string): void {
  if (cache.size >= MAX_CACHED) {
    // Oldest first: Map keeps insertion order, and the frames asked for longest
    // ago are the ones scrolled furthest away.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, uri);
}

async function frameAt(assetId: string, uri: string, atMs: number): Promise<string | null> {
  const key = thumbnailKey(assetId, atMs);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (VideoExport === null) return null;

  const decode = queue.then(async () => {
    // Checked again inside the queue: by the time this runs, another clip may
    // have asked for the same frame and paid for it already.
    const ready = cache.get(key);
    if (ready !== undefined) return ready;
    try {
      const frame = await VideoExport.extractFrame(uri, atMs);
      const dataUri = `data:${frame.mimeType};base64,${frame.base64}`;
      remember(key, dataUri);
      return dataUri;
    } catch {
      // A source that will not decode is not an error anyone can act on.
      return null;
    }
  });
  queue = decode.catch(() => undefined);
  return decode;
}

/**
 * The frames to draw across a clip, filling in as they decode.
 *
 * Returns what it has: an empty list at first, then one entry per slot. The
 * caller draws the clip the same either way and lets the frames appear.
 */
export function useClipThumbnails(
  input: { readonly assetId: string; readonly uri: string | null; readonly clip: ThumbnailClip; readonly widthPx: number }
): readonly string[] {
  const { assetId, uri, clip, widthPx } = input;
  const times = thumbnailTimesMs(clip, widthPx);
  // A string, so the effect below does not re-run for an array that is equal.
  const signature = times.join(',');
  const [frames, setFrames] = useState<readonly string[]>([]);

  useEffect(() => {
    if (uri === null || signature.length === 0) {
      setFrames([]);
      return;
    }
    let live = true;
    void (async () => {
      const wanted = signature.split(',').map(Number);
      const decoded: string[] = [];
      for (const atMs of wanted) {
        const frame = await frameAt(assetId, uri, atMs);
        if (!live) return;
        if (frame === null) continue;
        decoded.push(frame);
        // Shown as they arrive rather than at the end: the first frame is the
        // one that tells you which shot this is.
        setFrames([...decoded]);
      }
    })();
    return () => {
      live = false;
    };
  }, [assetId, signature, uri]);

  return frames;
}

/** Test seam: module-level state is deliberate, and deliberate state has to be resettable. */
export function resetThumbnailCacheForTests(): void {
  cache.clear();
  queue = Promise.resolve();
}
