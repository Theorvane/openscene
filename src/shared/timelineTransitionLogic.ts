import { setTransition, removeTransition } from './timelineMetadataLogic';
import type { TimelineDocument, TransitionDescriptor, TransitionType } from './timelineTypes';

/**
 * Putting a transition on a cut, and taking it off again.
 *
 * The validation already exists — `transitionsAreValid` insists on two adjacent
 * clips that touch, on the same video track, neither of them shorter than the
 * transition. What was missing is the part a screen needs: *which* cut, given
 * where the playhead is, because a transition is not addressed by selecting
 * something. It lives between two clips, and the only thing pointing at the
 * space between two clips is the playhead.
 *
 * Pure and shared, like every other editing rule: a dissolve placed on a phone
 * has to be the same dissolve when the project is opened on a desktop.
 */

/** Long enough to read as a dissolve, short enough not to eat a short clip. */
export const DEFAULT_TRANSITION_MS = 500;

export type TimelineCut = {
  readonly trackId: string;
  readonly fromClipId: string;
  readonly toClipId: string;
  readonly cutMs: number;
};

function clipEndMs(clip: { readonly timelineStartMs: number; readonly sourceStartMs: number; readonly sourceEndMs: number }): number {
  return clip.timelineStartMs + (clip.sourceEndMs - clip.sourceStartMs);
}

/** Every place two video clips touch, which is every place a transition may go. */
export function cuts(timeline: TimelineDocument): readonly TimelineCut[] {
  const found: TimelineCut[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    const ordered = [...track.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
    ordered.forEach((clip, index) => {
      const next = ordered[index + 1];
      // Touching, not merely consecutive: a gap between two clips is a cut to
      // black already, and there is nothing there to dissolve.
      if (next === undefined || clipEndMs(clip) !== next.timelineStartMs) return;
      found.push({ trackId: track.id, fromClipId: clip.id, toClipId: next.id, cutMs: next.timelineStartMs });
    });
  }
  return found;
}

/**
 * The cut the playhead is pointing at, within a tolerance.
 *
 * A tolerance rather than an exact hit, because nobody parks a playhead on an
 * exact millisecond — on a phone a finger is worth tens of them. The nearest
 * one wins when two are in range, which is the answer a person expects when
 * they put the playhead between two cuts and reach for the button.
 */
export function cutNearest(timeline: TimelineDocument, playheadMs: number, toleranceMs = 400): TimelineCut | null {
  let best: TimelineCut | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cut of cuts(timeline)) {
    const distance = Math.abs(cut.cutMs - playheadMs);
    if (distance <= toleranceMs && distance < bestDistance) {
      best = cut;
      bestDistance = distance;
    }
  }
  return best;
}

export function transitionForCut(timeline: TimelineDocument, cut: TimelineCut): TransitionDescriptor | null {
  return (
    timeline.transitions.find(
      (candidate) => candidate.fromClipId === cut.fromClipId && candidate.toClipId === cut.toClipId
    ) ?? null
  );
}

/**
 * Adds or replaces the transition on a cut.
 *
 * `null` when the rules refuse — most often because the transition is longer
 * than one of the two clips it has to fit inside — so the caller keeps what it
 * had and can say why.
 */
export function setTransitionAtCut(
  timeline: TimelineDocument,
  cut: TimelineCut,
  input: { readonly type: TransitionType; readonly durationMs?: number }
): TimelineDocument | null {
  return setTransition(timeline, {
    fromClipId: cut.fromClipId,
    toClipId: cut.toClipId,
    type: input.type,
    durationMs: Math.round(input.durationMs ?? DEFAULT_TRANSITION_MS)
  });
}

export function removeTransitionAtCut(timeline: TimelineDocument, cut: TimelineCut): TimelineDocument {
  return removeTransition(timeline, { fromClipId: cut.fromClipId, toClipId: cut.toClipId });
}

/**
 * What a transition does to a picture at a moment.
 *
 * These two are the whole visual rule, and they are here rather than in a
 * renderer because three of them have to agree: the desktop program monitor,
 * the phone preview, and the FFmpeg graph. The first two used to be one
 * implementation and one absence, which is how a transition came to be
 * something you could see in the editor and never in the file.
 *
 * The window is the cut plus and minus half the duration. Over the first half
 * the outgoing clip goes to nothing; over the second the incoming one arrives.
 * Adjacent clips do not overlap — the timeline refuses it — so what a viewer
 * sees is a dip through the black underneath, and that is what every renderer
 * must produce.
 */

type Span = {
  readonly transition: TransitionDescriptor;
  readonly cutMs: number;
  readonly halfMs: number;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Named `span`, not `window`: the shared core is checked for DOM reaches, and a
// local called `window` reads exactly like one.
function spanAt(timeline: TimelineDocument, timeMs: number): Span | null {
  for (const cut of cuts(timeline)) {
    const transition = transitionForCut(timeline, cut);
    if (transition === null || transition.durationMs <= 0) continue;
    const halfMs = transition.durationMs / 2;
    if (timeMs < cut.cutMs - halfMs || timeMs > cut.cutMs + halfMs) continue;
    return { transition, cutMs: cut.cutMs, halfMs };
  }
  return null;
}

/** The multiplier on a clip's own opacity, which is 1 wherever no transition reaches. */
export function transitionAlphaForClip(timeline: TimelineDocument, clipId: string, timeMs: number): number {
  const span = spanAt(timeline, timeMs);
  // A dip to black is drawn over the finished picture instead, so the clips
  // underneath keep the opacity they were given.
  if (span === null || span.transition.type === 'dipToBlack') return 1;
  if (span.transition.fromClipId === clipId) return clamp((span.cutMs - timeMs) / span.halfMs, 0, 1);
  if (span.transition.toClipId === clipId) return clamp((timeMs - span.cutMs) / span.halfMs, 0, 1);
  return 1;
}

/** How black the frame is over everything, which is 0 unless a dip is running. */
export function dipToBlackOpacityAt(timeline: TimelineDocument, timeMs: number): number {
  const span = spanAt(timeline, timeMs);
  if (span === null || span.transition.type !== 'dipToBlack') return 0;
  const progress = clamp((timeMs - (span.cutMs - span.halfMs)) / span.transition.durationMs, 0, 1);
  return 1 - Math.abs(progress - 0.5) * 2;
}
