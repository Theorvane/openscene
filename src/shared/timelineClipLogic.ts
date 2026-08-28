import { clipTimelineEndMs, sortTimelineClips, sourceTimeMsAt } from './timelineClipGeometry';
import { clipEffectsEqual, hasOnlyClipEffectKeys, isValidClipEffects, normalizeClipEffects } from './timelineEffects';
import { pruneInvalidTransitions } from './timelineMetadataLogic';
import { parseClipKeyframes } from './timelineMetadataValidators';
import type {
  MoveClipInput,
  PlaceClipInput,
  PersistedTimelineClip,
  SplitClipInput,
  TimelineClip,
  TimelineDocument,
  TimelineTrack,
  TrimClipLeftInput,
  TrimClipRightInput,
  UpdateClipEffectsInput
} from './timelineTypes';

type LocatedClip = {
  readonly clip: PersistedTimelineClip;
  readonly track: TimelineTrack;
};

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isOpaqueId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function normalizeClip(clip: TimelineClip): PersistedTimelineClip | null {
  const effects = normalizeClipEffects(clip.effects);
  if (effects === null) return null;
  const normalized = { ...clip, effects, keyframes: [] };
  const keyframes = parseClipKeyframes(clip.keyframes ?? [], normalized);
  return keyframes === null ? null : { ...normalized, keyframes };
}

function isValidClip(clip: PersistedTimelineClip): boolean {
  return (
    isOpaqueId(clip.id) &&
    isOpaqueId(clip.assetId) &&
    isFiniteNonNegative(clip.timelineStartMs) &&
    isFiniteNonNegative(clip.sourceStartMs) &&
    isFiniteNonNegative(clip.sourceEndMs) &&
    isFiniteNonNegative(clip.sourceDurationMs) &&
    clip.sourceEndMs > clip.sourceStartMs &&
    clip.sourceEndMs <= clip.sourceDurationMs &&
    isValidClipEffects(clip.effects) &&
    parseClipKeyframes(clip.keyframes, clip)?.length === clip.keyframes.length
  );
}

function findClip(timeline: TimelineDocument, clipId: string): LocatedClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip !== undefined) return { clip, track };
  }
  return null;
}

function hasClipId(timeline: TimelineDocument, clipId: string): boolean {
  return findClip(timeline, clipId) !== null;
}

function overlapsTrack(track: TimelineTrack, candidate: PersistedTimelineClip, excludedClipId?: string): boolean {
  const candidateEndMs = clipTimelineEndMs(candidate);
  return track.clips.some(
    (clip) => clip.id !== excludedClipId && candidate.timelineStartMs < clipTimelineEndMs(clip) && candidateEndMs > clip.timelineStartMs
  );
}

function replaceClip(timeline: TimelineDocument, located: LocatedClip, clip: PersistedTimelineClip): TimelineDocument | null {
  const boundedClip = {
    ...clip,
    keyframes: clip.keyframes.filter(
      (keyframe) => keyframe.timelineTimeMs >= clip.timelineStartMs && keyframe.timelineTimeMs <= clipTimelineEndMs(clip)
    )
  };
  if (!isValidClip(boundedClip) || overlapsTrack(located.track, boundedClip, located.clip.id)) return null;
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: sortTimelineClips(track.clips.map((current) => current.id === boundedClip.id ? boundedClip : current)) }
        : track
    )
  });
}

export function placeClip(timeline: TimelineDocument, input: PlaceClipInput): TimelineDocument | null {
  const track = timeline.tracks.find((candidate) => candidate.id === input.trackId);
  const clip = normalizeClip(input.clip);
  if (track === undefined || hasClipId(timeline, input.clip.id) || clip === null || !isValidClip(clip) || overlapsTrack(track, clip)) return null;
  return {
    ...timeline,
    tracks: timeline.tracks.map((candidate) =>
      candidate.id === track.id ? { ...candidate, clips: sortTimelineClips([...candidate.clips, clip]) } : candidate
    )
  };
}

export function moveClip(timeline: TimelineDocument, input: MoveClipInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  const targetTrack = timeline.tracks.find((track) => track.id === input.targetTrackId);
  if (located === null || targetTrack === undefined || !isFiniteNonNegative(input.timelineStartMs)) return null;
  if (located.track.id === targetTrack.id && located.clip.timelineStartMs === input.timelineStartMs) return timeline;
  const deltaMs = input.timelineStartMs - located.clip.timelineStartMs;
  const movedClip = {
    ...located.clip,
    timelineStartMs: input.timelineStartMs,
    keyframes: located.clip.keyframes.map((keyframe) => ({ ...keyframe, timelineTimeMs: keyframe.timelineTimeMs + deltaMs }))
  };
  if (overlapsTrack(targetTrack, movedClip, located.clip.id)) return null;
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id === located.track.id && track.id === targetTrack.id) {
        return { ...track, clips: sortTimelineClips(track.clips.map((clip) => clip.id === movedClip.id ? movedClip : clip)) };
      }
      if (track.id === located.track.id) return { ...track, clips: track.clips.filter((clip) => clip.id !== movedClip.id) };
      return track.id === targetTrack.id ? { ...track, clips: sortTimelineClips([...track.clips, movedClip]) } : track;
    })
  });
}

export function trimClipLeft(timeline: TimelineDocument, input: TrimClipLeftInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isFiniteNonNegative(input.timelineStartMs)) return null;
  if (located.clip.timelineStartMs === input.timelineStartMs) return timeline;
  // Timeline milliseconds, converted into the source's own. At 1× these are
  // the same number, which is why the difference went unnoticed until a clip
  // could be retimed: dragging the head of a 2× clip by a second has to consume
  // two seconds of the file.
  return replaceClip(timeline, located, {
    ...located.clip,
    timelineStartMs: input.timelineStartMs,
    sourceStartMs: sourceTimeMsAt(located.clip, input.timelineStartMs)
  });
}

export function trimClipRight(timeline: TimelineDocument, input: TrimClipRightInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isFiniteNonNegative(input.timelineEndMs)) return null;
  const currentEndMs = clipTimelineEndMs(located.clip);
  if (currentEndMs === input.timelineEndMs) return timeline;
  return replaceClip(timeline, located, {
    ...located.clip,
    sourceEndMs: sourceTimeMsAt(located.clip, input.timelineEndMs)
  });
}

/**
 * Point a clip at a different file without moving anything.
 *
 * A regenerated take of a shot is a new file that stands in the same place: the
 * cut around it has not changed, and everything after it must not slide because
 * the second take came back a few frames longer. So the clip keeps its start
 * and its length, and only its source changes.
 *
 * Refused rather than shortened when the new file is too short to fill the
 * clip. A take that cannot cover the shot is a take to run again, not a hole to
 * paper over by quietly retiming the cut.
 */
export function replaceClipSource(
  timeline: TimelineDocument,
  input: { readonly clipId: string; readonly assetId: string; readonly sourceDurationMs: number }
): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isOpaqueId(input.assetId) || !isFiniteNonNegative(input.sourceDurationMs)) return null;

  // The span of source the clip consumes, which is its timeline length times
  // its speed — a retimed clip needs more or less of the file than it shows.
  const spanMs = located.clip.sourceEndMs - located.clip.sourceStartMs;
  if (spanMs <= 0 || input.sourceDurationMs < spanMs) return null;

  return replaceClip(timeline, located, {
    ...located.clip,
    assetId: input.assetId,
    // From the top of the new file: a second take has no reason to share the
    // first one's in-point, and there is nothing before it to trim away.
    sourceStartMs: 0,
    sourceEndMs: spanMs,
    sourceDurationMs: input.sourceDurationMs
  });
}

export function updateClipEffects(timeline: TimelineDocument, input: UpdateClipEffectsInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !hasOnlyClipEffectKeys(input.effects)) return null;
  const effects = { ...located.clip.effects, ...input.effects };
  if (!isValidClipEffects(effects)) return null;
  if (clipEffectsEqual(effects, located.clip.effects)) return timeline;
  /*
    Through `replaceClip`, not around it.

    Every other effect leaves the clip exactly where it was, so writing the new
    effects straight into the track was harmless — and speed broke that. A
    retimed clip is a different length, which can put it on top of its
    neighbour, and can pull it away from a cut a transition was sitting on.

    Skipping the shared path once produced a project the app could not reopen:
    the file was written with a transition whose two clips no longer touched,
    the validator refused the whole document on the next read, and the editor
    came back with no project at all. Overlap and transition pruning both live
    in `replaceClip`, so this asks it rather than repeating it.
  */
  return replaceClip(timeline, located, { ...located.clip, effects });
}

export function splitClip(timeline: TimelineDocument, input: SplitClipInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (
    located === null ||
    !isFiniteNonNegative(input.atMs) ||
    !isOpaqueId(input.rightClipId) ||
    hasClipId(timeline, input.rightClipId) ||
    input.atMs <= located.clip.timelineStartMs ||
    input.atMs >= clipTimelineEndMs(located.clip)
  ) return null;
  const sourceSplitMs = sourceTimeMsAt(located.clip, input.atMs);
  const leftClip = {
    ...located.clip,
    sourceEndMs: sourceSplitMs,
    keyframes: located.clip.keyframes.filter((keyframe) => keyframe.timelineTimeMs <= input.atMs)
  };
  const rightClip = {
    ...located.clip,
    id: input.rightClipId,
    timelineStartMs: input.atMs,
    sourceStartMs: sourceSplitMs,
    keyframes: located.clip.keyframes.filter((keyframe) => keyframe.timelineTimeMs >= input.atMs)
  };
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: sortTimelineClips(track.clips.flatMap((clip) => clip.id === located.clip.id ? [leftClip, rightClip] : [clip])) }
        : track
    ),
    transitions: timeline.transitions.map((transition) => ({
      ...transition,
      fromClipId: transition.fromClipId === located.clip.id ? rightClip.id : transition.fromClipId,
      toClipId: transition.toClipId === located.clip.id ? leftClip.id : transition.toClipId
    }))
  });
}

export function deleteClip(timeline: TimelineDocument, clipId: string): TimelineDocument {
  const located = findClip(timeline, clipId);
  if (located === null) return timeline;
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) } : track
    ),
    transitions: timeline.transitions.filter((transition) => transition.fromClipId !== clipId && transition.toClipId !== clipId)
  };
}
