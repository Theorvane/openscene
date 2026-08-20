import { clipTimelineEndMs, sourceTimeMsAt } from './timelineClipGeometry';
import type { PersistedTimelineClip, TimelineDocument } from './timelineTypes';

/**
 * What is on screen, and what is audible, at a given moment.
 *
 * Both hosts have to answer this and they must answer it the same way: the
 * desktop's program monitor draws from it, the phone's preview seeks a player
 * with it, and `buildCompositionPlan` stacks layers by the same rule. A preview
 * that disagrees with the export is worse than no preview, because the user
 * trusts what they saw.
 *
 * The rule is the document's own: the first track is the topmost, so the first
 * track with an active clip wins the picture. Audio does not stack — everything
 * unmuted is audible at once.
 */

/** A clip covers a moment from its start up to, but not including, its end. */
export function isClipActiveAt(clip: PersistedTimelineClip, playheadMs: number): boolean {
  return playheadMs >= clip.timelineStartMs && playheadMs < clipTimelineEndMs(clip);
}

/** Where in the source file the playhead is sitting, honouring the clip's trim. */
export function sourceTimeForClip(clip: PersistedTimelineClip, playheadMs: number): number {
  // Converted rather than added: a clip at 2× is halfway through its source when
  // the playhead is a quarter of the way across it.
  return sourceTimeMsAt(clip, playheadMs);
}

export type ActiveClip = {
  readonly clip: PersistedTimelineClip;
  readonly trackId: string;
  /** Milliseconds into the source file, not into the timeline. */
  readonly sourceTimeMs: number;
};

/**
 * The clip that owns the picture at `playheadMs`, or null over a gap.
 *
 * Track order is layer order and the first track is the topmost, so the search
 * runs in document order and stops at the first hit — the same inversion
 * `buildCompositionPlan` applies when it reverses the layers for a renderer that
 * stacks bottom-first.
 */
export function resolveVisibleClip(timeline: TimelineDocument, playheadMs: number): ActiveClip | null {
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      if (!isClipActiveAt(clip, playheadMs)) continue;
      // A fully transparent clip is not what the viewer sees; the layer below it
      // is, exactly as the export composites it.
      if (clip.effects.opacity <= 0) continue;
      return { clip, trackId: track.id, sourceTimeMs: sourceTimeForClip(clip, playheadMs) };
    }
  }
  return null;
}

/** Every audible clip at `playheadMs`, muted tracks excluded. */
export function resolveAudibleClips(timeline: TimelineDocument, playheadMs: number): readonly ActiveClip[] {
  const active: ActiveClip[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'audio' || track.mix.muted) continue;
    for (const clip of track.clips) {
      if (!isClipActiveAt(clip, playheadMs)) continue;
      active.push({ clip, trackId: track.id, sourceTimeMs: sourceTimeForClip(clip, playheadMs) });
    }
  }
  return active;
}

/**
 * The next moment the picture changes after `playheadMs`, or null if nothing
 * changes again. Playback uses it to know when to swap sources instead of
 * polling every frame for a clip it already knows is still running.
 */
export function nextVisualBoundaryMs(timeline: TimelineDocument, playheadMs: number): number | null {
  let soonest: number | null = null;
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      for (const edge of [clip.timelineStartMs, clipTimelineEndMs(clip)]) {
        if (edge <= playheadMs) continue;
        if (soonest === null || edge < soonest) soonest = edge;
      }
    }
  }
  return soonest;
}
