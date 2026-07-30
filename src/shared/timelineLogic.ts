import type { AddTrackInput, TimelineDocument, TimelineTrack } from './timelineTypes';
import { clipTimelineEndMs } from './timelineClipGeometry';
import { DEFAULT_AUDIO_TRACK_MIX, TIMELINE_SCHEMA_VERSION } from './timelineTypes';

export { clipDurationMs, clipTimelineEndMs } from './timelineClipGeometry';
export {
  deleteClip,
  moveClip,
  placeClip,
  splitClip,
  trimClipLeft,
  trimClipRight,
  updateClipEffects
} from './timelineClipLogic';
export {
  addClipKeyframe,
  removeClipKeyframe,
  removeTransition,
  setTransition,
  updateAudioTrackMix,
  updateClipKeyframe
} from './timelineMetadataLogic';

export const INITIAL_VIDEO_TRACK_ID = 'video-track-1' as const;
export const INITIAL_AUDIO_TRACK_ID = 'audio-track-1' as const;

export function createInitialTimeline(): TimelineDocument {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [
      { id: INITIAL_VIDEO_TRACK_ID, name: 'Video 1', kind: 'video', clips: [] },
      { id: INITIAL_AUDIO_TRACK_ID, name: 'Audio 1', kind: 'audio', clips: [], mix: { ...DEFAULT_AUDIO_TRACK_MIX } }
    ],
    transitions: []
  };
}

/**
 * Track order is layer order: tracks[0] is the top row in the timeline and the
 * topmost video layer. The compiler reverses this when building its overlay
 * chain, since FFmpeg stacks later overlays on top.
 */
export function removeTrack(timeline: TimelineDocument, trackId: string): TimelineDocument | null {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) return null;
  // Removing the last track of a kind would leave imports of that kind with
  // nowhere to land, and the editor with no row to drop onto.
  if (timeline.tracks.filter((candidate) => candidate.kind === track.kind).length <= 1) return null;
  return {
    ...timeline,
    tracks: timeline.tracks.filter((candidate) => candidate.id !== trackId),
    // A transition referring to a clip that just left would dangle.
    transitions: timeline.transitions.filter(
      (transition) => !track.clips.some((clip) => clip.id === transition.fromClipId || clip.id === transition.toClipId)
    )
  };
}

export function renameTrack(timeline: TimelineDocument, trackId: string, name: string): TimelineDocument | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (!timeline.tracks.some((track) => track.id === trackId)) return null;
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => (track.id === trackId ? { ...track, name: trimmed } : track))
  };
}

/**
 * Inserts a track directly above or below an existing one. Position matters:
 * track order is layer order, so inserting above puts the new track over the
 * reference track in the composite.
 */
export function addTrackBeside(
  timeline: TimelineDocument,
  reference: { readonly trackId: string; readonly position: 'above' | 'below' },
  input: AddTrackInput
): TimelineDocument | null {
  const index = timeline.tracks.findIndex((track) => track.id === reference.trackId);
  if (index === -1) return null;

  // Reuse addTrack for validation so the id, name, and duplicate rules cannot
  // drift between appending and inserting.
  const appended = addTrack(timeline, input);
  if (appended === null) return null;
  const created = appended.tracks[appended.tracks.length - 1];
  if (created === undefined) return null;

  const tracks = [...timeline.tracks];
  tracks.splice(reference.position === 'above' ? index : index + 1, 0, created);
  return { ...timeline, tracks };
}

export function timelineDurationMs(timeline: TimelineDocument): number {
  let durationMs = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) durationMs = Math.max(durationMs, clipTimelineEndMs(clip));
  }
  return durationMs;
}

export function addTrack(timeline: TimelineDocument, input: AddTrackInput): TimelineDocument | null {
  const name = input.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.id) || input.id.length > 128 || name.length === 0 || name.length > 80 || timeline.tracks.some((track) => track.id === input.id)) {
    return null;
  }
  const track: TimelineTrack = input.kind === 'video'
    ? { ...input, kind: 'video', name, clips: [] }
    : { ...input, kind: 'audio', name, clips: [], mix: { ...DEFAULT_AUDIO_TRACK_MIX } };
  return { ...timeline, tracks: [...timeline.tracks, track] };
}
