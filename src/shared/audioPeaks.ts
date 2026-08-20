/**
 * The shape of a sound, and how much of it to ask for.
 *
 * An audio clip was a coloured block with a filename on it: nothing to aim at,
 * so finding a beat or a gap meant scrubbing and listening one guess at a time.
 * Video clips got frames for exactly this reason; sound never did.
 *
 * Shared for the same reason the thumbnail sampling is: the same clip has to
 * draw the same shape on a phone and on a desktop, or the two are different
 * pictures of one file.
 */

export type PeakClip = {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
};

/** Narrower than this and a waveform is a smear, so the clip stays a block. */
export const MIN_WAVEFORM_WIDTH_PX = 24;

/** One bar per this many points of width: fine enough to see a beat, coarse enough to decode. */
export const PX_PER_BAR = 3;

/** Past this a long clip costs more to read than the picture is worth. */
export const MAX_BARS = 400;

/** How many bars a clip of this width should ask for; zero means "draw nothing". */
export function barCountFor(clip: PeakClip, widthPx: number): number {
  const durationMs = clip.sourceEndMs - clip.sourceStartMs;
  if (!Number.isFinite(widthPx) || widthPx < MIN_WAVEFORM_WIDTH_PX || durationMs <= 0) return 0;
  return Math.max(1, Math.min(MAX_BARS, Math.floor(widthPx / PX_PER_BAR)));
}

/**
 * A key for one read of one clip's sound.
 *
 * The source window is part of it because trimming a clip changes which part of
 * the file is on screen, and rounded because nudging by a frame should not
 * throw the reading away.
 */
export function peaksKey(assetId: string, clip: PeakClip, bars: number): string {
  const round = (value: number) => Math.round(value / 250) * 250;
  return `${assetId}@${round(clip.sourceStartMs)}-${round(clip.sourceEndMs)}x${bars}`;
}

/**
 * Peaks as bar heights, in the range a renderer can draw.
 *
 * Normalised against the loudest bar rather than against full scale: a quiet
 * recording would otherwise draw as a flat line, which says "no sound here"
 * about a clip that has plenty. The floor keeps silence visible as a hairline
 * instead of a gap, so a clip never looks like it failed to load.
 */
export function barHeights(peaks: readonly number[]): readonly number[] {
  const loudest = peaks.reduce((high, peak) => (Number.isFinite(peak) && peak > high ? peak : high), 0);
  if (loudest <= 0) return peaks.map(() => 0.02);
  return peaks.map((peak) => {
    const value = Number.isFinite(peak) ? Math.max(0, peak) : 0;
    return Math.max(0.02, Math.min(1, value / loudest));
  });
}
