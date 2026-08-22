import { useEffect, useState } from 'react';

import { barCountFor, barHeights, peaksKey, type PeakClip } from '../../../shared/audioPeaks';

/**
 * The shape of a sound, on the desktop timeline.
 *
 * An audio clip was a coloured block with a filename on it: nothing to aim at,
 * so finding a beat or a gap meant scrubbing and listening one guess at a time.
 * The phone learned to draw this first; a feature that lives on one surface is
 * the gap this repository keeps closing, and the rules for *what* to draw are
 * shared so the same clip has the same shape in both places.
 *
 * Decoded with Web Audio rather than by spawning FFmpeg per clip, for the same
 * reason the filmstrip decodes with a `<video>` element: the asset already has a
 * playback URL, Chromium already has the decoders, and a process per clip on a
 * busy timeline is the cost this avoids.
 *
 * Best-effort throughout: nothing blocks an edit, nothing throws outward, and a
 * source that will not decode leaves the clip drawn exactly as it was before.
 */

/**
 * One envelope per source, not one per clip.
 *
 * `decodeAudioData` wants the whole file, so decoding per clip would decode a
 * ten-minute track once for every cut made from it. The envelope is read once,
 * kept at a fixed resolution, and every clip's bars are taken out of it —
 * trimming a clip then costs an array slice rather than a decode.
 */
const envelopes = new Map<string, readonly number[]>();

/** Bars, per clip and width, so redrawing a scrolled timeline costs nothing. */
const bars = new Map<string, readonly number[]>();

/** Enough for a busy timeline; an envelope is numbers, not audio. */
const MAX_CACHED_ENVELOPES = 24;
const MAX_CACHED_BARS = 200;

/**
 * Twenty buckets a second.
 *
 * Fine enough that a bar of a two-second clip is still an average of one frame
 * rather than of a phrase, and coarse enough that an hour of audio is seventy
 * thousand numbers rather than a copy of the file.
 */
const BUCKETS_PER_SECOND = 20;

/** One decode at a time: a screenful of audio clips would otherwise ask for all of it at once. */
let queue: Promise<unknown> = Promise.resolve();

function remember<T>(store: Map<string, T>, key: string, value: T, limit: number): void {
  store.set(key, value);
  if (store.size > limit) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
}

/**
 * The loudest sample in each bucket, across the whole file.
 *
 * Peak rather than average: an average of a waveform is a line near zero, which
 * is what a quiet-looking waveform of a loud recording is made of.
 */
async function envelopeFor(assetId: string, url: string): Promise<readonly number[]> {
  const cached = envelopes.get(assetId);
  if (cached !== undefined) return cached;

  const read = queue.then(async () => {
    const existing = envelopes.get(assetId);
    if (existing !== undefined) return existing;
    let context: AudioContext | null = null;
    try {
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      context = new AudioContext();
      const audio = await context.decodeAudioData(bytes);

      const buckets = Math.max(1, Math.round(audio.duration * BUCKETS_PER_SECOND));
      const perBucket = Math.max(1, Math.floor(audio.length / buckets));
      const peaks = new Array<number>(buckets).fill(0);
      // Every channel, because sound panned hard to one side is still sound —
      // reading channel zero alone draws silence for it.
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        const samples = audio.getChannelData(channel);
        for (let bucket = 0; bucket < buckets; bucket += 1) {
          const start = bucket * perBucket;
          const end = Math.min(samples.length, start + perBucket);
          let loudest = peaks[bucket] ?? 0;
          for (let index = start; index < end; index += 1) {
            const level = Math.abs(samples[index] ?? 0);
            if (level > loudest) loudest = level;
          }
          peaks[bucket] = loudest;
        }
      }
      remember(envelopes, assetId, peaks, MAX_CACHED_ENVELOPES);
      return peaks as readonly number[];
    } catch {
      // A file that will not decode is a clip drawn as a block, which is what it
      // looked like before this existed.
      remember(envelopes, assetId, [], MAX_CACHED_ENVELOPES);
      return [] as readonly number[];
    } finally {
      void context?.close().catch(() => undefined);
    }
  });
  queue = read.catch(() => undefined);
  return read;
}

/** The clip's window of the envelope, reduced to the bars the width allows. */
function barsFrom(envelope: readonly number[], clip: PeakClip, count: number): readonly number[] {
  if (envelope.length === 0 || count <= 0) return [];
  const perMs = BUCKETS_PER_SECOND / 1000;
  const from = Math.max(0, Math.floor(clip.sourceStartMs * perMs));
  const to = Math.min(envelope.length, Math.ceil(clip.sourceEndMs * perMs));
  const window = envelope.slice(from, Math.max(from + 1, to));

  const peaks = new Array<number>(count).fill(0);
  for (let bar = 0; bar < count; bar += 1) {
    const start = Math.floor((bar * window.length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * window.length) / count));
    let loudest = 0;
    for (let index = start; index < end; index += 1) {
      const level = window[index] ?? 0;
      if (level > loudest) loudest = level;
    }
    peaks[bar] = loudest;
  }
  return barHeights(peaks);
}

export function useClipWaveform(input: {
  readonly assetId: string;
  readonly url: string | null;
  readonly clip: PeakClip;
  readonly widthPx: number;
}): readonly number[] {
  const { assetId, url, clip, widthPx } = input;
  const count = barCountFor(clip, widthPx);
  const key = peaksKey(assetId, clip, count);
  const [heights, setHeights] = useState<readonly number[]>(() => bars.get(key) ?? []);

  useEffect(() => {
    if (url === null || count === 0) {
      setHeights([]);
      return;
    }
    const known = bars.get(key);
    if (known !== undefined) {
      setHeights(known);
      return;
    }
    let live = true;
    void envelopeFor(assetId, url).then((envelope) => {
      const drawn = barsFrom(envelope, clip, count);
      remember(bars, key, drawn, MAX_CACHED_BARS);
      if (live) setHeights(drawn);
    });
    return () => {
      live = false;
    };
    // `clip` is read through `key`, which rounds the source window: nudging a
    // trim by a frame must not throw the reading away and ask for another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, url, key, count]);

  return heights;
}

/** Test seam: module-level state is deliberate, and deliberate state has to be resettable. */
export function resetClipWaveformsForTests(): void {
  envelopes.clear();
  bars.clear();
  queue = Promise.resolve();
}
