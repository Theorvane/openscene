import type { MediaKind, TimelineClip } from './timelineTypes';

/**
 * A still on the timeline.
 *
 * The difference between a still and a clip is not what it looks like — both
 * are picture on a video track — it is that a still has no timeline of its own.
 * There is nothing to seek into and nothing to run out of: it is *held* for as
 * long as the clip says, and a renderer that opens it the way it opens a movie
 * gets one frame or an error.
 *
 * That is the whole rule, and it is here rather than in either renderer because
 * both need it and neither should decide it. FFmpeg expresses it as
 * `-loop 1 -t <seconds>` on the input; AVFoundation as a still layer with a
 * duration. Same rule, two dialects.
 */

/**
 * How long a still runs when nothing says otherwise.
 *
 * Four seconds is long enough to read a caption or take in a frame and short
 * enough that the first thing a user does is trim it rather than delete it.
 * A still has no intrinsic length, so *some* number has to be chosen; this one
 * is a starting point the user is expected to change, not a claim about the
 * picture.
 */
export const STILL_DEFAULT_HOLD_MS = 4_000;

/** Stills are picture, so they live on a video track — there is no image track. */
export function trackKindForAsset(kind: MediaKind): 'video' | 'audio' {
  return kind === 'audio' ? 'audio' : 'video';
}

export function isStill(kind: MediaKind): boolean {
  return kind === 'image';
}

/**
 * The source geometry of a still held for `holdMs`.
 *
 * `sourceDurationMs` is the hold rather than the length of the file, because a
 * still has no length: making the two equal is what lets the ordinary clip
 * validators — which check that a clip does not run past its source — accept a
 * still without being taught about one.
 */
export function stillClipSource(holdMs: number = STILL_DEFAULT_HOLD_MS): Pick<
  TimelineClip,
  'sourceStartMs' | 'sourceEndMs' | 'sourceDurationMs'
> {
  const hold = Math.max(1, Math.round(holdMs));
  return { sourceStartMs: 0, sourceEndMs: hold, sourceDurationMs: hold };
}

/**
 * Trimming a still lengthens it rather than running out of source.
 *
 * A movie clip cannot be dragged past its last frame; a still has no last
 * frame, so the same gesture should keep going. Callers extend the hold to
 * match whatever length the trim asked for.
 */
export function stillSourceForLength(lengthMs: number): Pick<
  TimelineClip,
  'sourceStartMs' | 'sourceEndMs' | 'sourceDurationMs'
> {
  return stillClipSource(lengthMs);
}
