import { useEffect, useState } from 'react';

import { barCountFor, barHeights, peaksKey, type PeakClip } from '@openvideo/shared/audioPeaks';
import VideoExport from '../../modules/video-export';

/**
 * A clip's waveform, read once and remembered.
 *
 * The same bargain the thumbnails strike: best-effort, never blocking an edit,
 * and a file that will not decode leaves the clip exactly as it looked before.
 * Reads are queued one at a time because decoding is expensive and a screenful
 * of audio clips would otherwise ask for all of it at once.
 *
 * The cache is module-level because a clip is unmounted every time it scrolls
 * out of view, and decoding the same seconds again each time is measured in
 * dropped frames.
 */

const cache = new Map<string, readonly number[]>();

/** Enough for a busy timeline; a reading is a few hundred numbers, not a file. */
const MAX_CACHED = 120;

let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, peaks: readonly number[]): void {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, peaks);
}

export function useAudioPeaks(input: {
  readonly assetId: string;
  readonly uri: string | null;
  readonly clip: PeakClip;
  readonly widthPx: number;
}): readonly number[] {
  const { assetId, uri, clip, widthPx } = input;
  const bars = barCountFor(clip, widthPx);
  const key = peaksKey(assetId, clip, bars);
  const [heights, setHeights] = useState<readonly number[]>([]);

  useEffect(() => {
    if (uri === null || bars === 0 || VideoExport === null) {
      setHeights([]);
      return;
    }
    const cached = cache.get(key);
    if (cached !== undefined) {
      setHeights(barHeights(cached));
      return;
    }

    let live = true;
    const read = queue.then(async () => {
      const ready = cache.get(key);
      if (ready !== undefined) return ready;
      try {
        const peaks = await VideoExport.readAudioPeaks(uri, clip.sourceStartMs, clip.sourceEndMs, bars);
        // An empty reading is remembered too: a file that cannot be decoded
        // will not decode on the next scroll either.
        remember(key, peaks);
        return peaks;
      } catch {
        remember(key, []);
        return [];
      }
    });
    queue = read.catch(() => undefined);
    void read.then((peaks) => {
      if (live) setHeights(peaks.length === 0 ? [] : barHeights(peaks));
    });

    return () => {
      live = false;
    };
  }, [assetId, bars, clip.sourceEndMs, clip.sourceStartMs, key, uri]);

  return heights;
}

/** Test seam: module-level state is deliberate, and deliberate state has to be resettable. */
export function resetAudioPeaksForTests(): void {
  cache.clear();
  queue = Promise.resolve();
}
