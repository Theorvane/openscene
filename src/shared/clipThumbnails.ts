/**
 * Which frames a clip shows along its length.
 *
 * Pure and shared so the two surfaces sample the *same* moments: a project that
 * shows the fourth second of a shot on a desktop and the second second of it on
 * a phone is two different timelines to look at, and the whole point of a
 * thumbnail is recognising the shot you already saw.
 *
 * Source times, not timeline times. A clip is a window into its source, so the
 * frame at the left edge is `sourceStartMs` however the clip has been moved.
 */

export type ThumbnailClip = {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
};

/** Below this a clip is too narrow to show a frame at all, so it shows none. */
export const MIN_THUMBNAIL_WIDTH_PX = 28;

/** How much width one frame wants. Wider than a thumbnail is tall, because clips are wide. */
export const THUMBNAIL_SLOT_PX = 64;

/** More than this and a long clip on a zoomed-in timeline decodes for minutes. */
export const MAX_THUMBNAILS = 12;

/**
 * The source times to draw, left to right.
 *
 * Sampled at the middle of each slot rather than at its edge: the first frame of
 * a cut is often black or a fade, and a strip that opens on black tells you
 * nothing about the shot.
 */
export function thumbnailTimesMs(clip: ThumbnailClip, widthPx: number): readonly number[] {
  const durationMs = clip.sourceEndMs - clip.sourceStartMs;
  if (!Number.isFinite(widthPx) || widthPx < MIN_THUMBNAIL_WIDTH_PX || durationMs <= 0) return [];

  const count = Math.max(1, Math.min(MAX_THUMBNAILS, Math.floor(widthPx / THUMBNAIL_SLOT_PX)));
  const slotMs = durationMs / count;
  return Array.from({ length: count }, (_, index) =>
    Math.round(clip.sourceStartMs + slotMs * index + slotMs / 2)
  );
}

/**
 * A key for one extracted frame.
 *
 * Rounded to a quarter second, so nudging a clip by a frame does not throw away
 * every thumbnail it had and decode them all again.
 */
export function thumbnailKey(assetId: string, atMs: number): string {
  return `${assetId}@${Math.round(atMs / 250) * 250}`;
}
