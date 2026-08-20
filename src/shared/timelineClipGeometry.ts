import type { TimelineClip } from './timelineTypes';

/**
 * How much source a clip uses, in the source's own time.
 *
 * Distinct from how long it lasts on the timeline, and the two used to be the
 * same number written out by hand in eight files. Speed separates them: two
 * seconds of source at 2× occupies one second of the cut. Wherever the question
 * is "which part of the file", this is the answer; wherever it is "how long is
 * this on screen", `clipDurationMs` is.
 */
export function clipSourceSpanMs(clip: TimelineClip): number {
  return clip.sourceEndMs - clip.sourceStartMs;
}

/** Rate a clip plays at. Absent means 1, which is what every project before speed has. */
export const NORMAL_SPEED = 1;

export function clipSpeed(clip: TimelineClip): number {
  const speed = clip.effects?.speed ?? NORMAL_SPEED;
  // A zero or negative rate is not slow motion, it is a clip of no length and a
  // division by zero behind it.
  return Number.isFinite(speed) && speed > 0 ? speed : NORMAL_SPEED;
}

/** How long the clip occupies on the timeline. */
export function clipDurationMs(clip: TimelineClip): number {
  return clipSourceSpanMs(clip) / clipSpeed(clip);
}

/**
 * Where a timeline moment lands inside the source.
 *
 * The one conversion playback, splitting and trimming all depend on, so it is
 * written once. At 1× it is the addition it always was.
 */
export function sourceTimeMsAt(clip: TimelineClip, timelineMs: number): number {
  return clip.sourceStartMs + (timelineMs - clip.timelineStartMs) * clipSpeed(clip);
}

/** Where a source moment lands on the timeline: the inverse of `sourceTimeMsAt`. */
export function timelineTimeMsAt(clip: TimelineClip, sourceMs: number): number {
  return clip.timelineStartMs + (sourceMs - clip.sourceStartMs) / clipSpeed(clip);
}

export function clipTimelineEndMs(clip: TimelineClip): number {
  return clip.timelineStartMs + clipDurationMs(clip);
}

function compareClips(left: TimelineClip, right: TimelineClip): number {
  if (left.timelineStartMs !== right.timelineStartMs) {
    return left.timelineStartMs - right.timelineStartMs;
  }
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
}

export function sortTimelineClips<T extends TimelineClip>(clips: readonly T[]): readonly T[] {
  return [...clips].sort(compareClips);
}
