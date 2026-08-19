import { clipTimelineEndMs } from './timelineClipGeometry';
import { parseTimelineClip, parseTimelineClipV1, parseTimelineClipV2 } from './timelineClipValidators';
import { parseAudioTrackMix, parseTitles, parseTransitions } from './timelineMetadataValidators';
import type { MediaKind, PersistedTimelineClip, TimelineDocument, TimelineTrack } from './timelineTypes';
import { DEFAULT_AUDIO_TRACK_MIX, TIMELINE_SCHEMA_VERSION } from './timelineTypes';
import {
  TIMELINE_VALIDATION_LIMITS,
  getMediaKind,
  getOpaqueId,
  getTrimmedString,
  hasAllowedKeys,
  isPlainRecord,
  isUnknownArray
} from './timelineValidationPrimitives';

type ParsedTrackBase = {
  readonly id: string;
  readonly name: string;
  readonly kind: MediaKind;
  readonly clips: readonly PersistedTimelineClip[];
};

function compareClips(left: PersistedTimelineClip, right: PersistedTimelineClip): number {
  if (left.timelineStartMs !== right.timelineStartMs) return left.timelineStartMs - right.timelineStartMs;
  return left.id.localeCompare(right.id);
}

function parseTrackBase(
  value: Record<string, unknown>,
  parseClipValue: (clip: unknown) => PersistedTimelineClip | null
): ParsedTrackBase | null {
  const id = getOpaqueId(value, 'id');
  const name = getTrimmedString(value, 'name', TIMELINE_VALIDATION_LIMITS.nameLength);
  const kind = getMediaKind(value, 'kind');
  const rawClips = value.clips;
  if (id === null || name === null || kind === null || !isUnknownArray(rawClips) || rawClips.length > TIMELINE_VALIDATION_LIMITS.clipsPerTrack) {
    return null;
  }
  const clips: PersistedTimelineClip[] = [];
  const clipIds = new Set<string>();
  for (const rawClip of rawClips) {
    const clip = parseClipValue(rawClip);
    if (clip === null || clipIds.has(clip.id)) return null;
    clipIds.add(clip.id);
    clips.push(clip);
  }
  clips.sort(compareClips);
  let previousEndMs = 0;
  for (const clip of clips) {
    if (clip.timelineStartMs < previousEndMs) return null;
    previousEndMs = clipTimelineEndMs(clip);
  }
  return { id, name, kind, clips };
}

function parseCurrentTrack(value: unknown): TimelineTrack | null {
  if (!isPlainRecord(value)) return null;
  const kind = getMediaKind(value, 'kind');
  if (kind === 'video') {
    if (!hasAllowedKeys(value, ['id', 'name', 'kind', 'clips'])) return null;
    const track = parseTrackBase(value, parseTimelineClip);
    return track === null ? null : { ...track, kind: 'video' };
  }
  if (kind === 'audio') {
    if (!hasAllowedKeys(value, ['id', 'name', 'kind', 'clips', 'mix'])) return null;
    const track = parseTrackBase(value, parseTimelineClip);
    const mix = parseAudioTrackMix(value.mix);
    return track === null || mix === null ? null : { ...track, kind: 'audio', mix };
  }
  return null;
}

function legacyTrackParser(
  parseClipValue: (clip: unknown) => PersistedTimelineClip | null
): (value: unknown) => TimelineTrack | null {
  return (value) => {
    if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'name', 'kind', 'clips'])) return null;
    const track = parseTrackBase(value, parseClipValue);
    if (track === null) return null;
    return track.kind === 'video'
      ? { ...track, kind: 'video' }
      : { ...track, kind: 'audio', mix: { ...DEFAULT_AUDIO_TRACK_MIX } };
  };
}

function parseDocument(
  value: unknown,
  schemaVersion: number,
  parseTrackValue: (track: unknown) => TimelineTrack | null
): TimelineDocument | null {
  const allowedKeys =
    schemaVersion === TIMELINE_SCHEMA_VERSION
      ? ['schemaVersion', 'tracks', 'transitions', 'titles']
      : ['schemaVersion', 'tracks'];
  if (!isPlainRecord(value) || !hasAllowedKeys(value, allowedKeys) || value.schemaVersion !== schemaVersion) return null;
  const rawTracks = value.tracks;
  if (!isUnknownArray(rawTracks) || rawTracks.length > TIMELINE_VALIDATION_LIMITS.tracks) return null;
  const tracks: TimelineTrack[] = [];
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  let keyframeCount = 0;
  for (const rawTrack of rawTracks) {
    const track = parseTrackValue(rawTrack);
    if (track === null || trackIds.has(track.id)) return null;
    trackIds.add(track.id);
    for (const clip of track.clips) {
      if (clipIds.has(clip.id) || clipIds.size >= TIMELINE_VALIDATION_LIMITS.clipsTotal) return null;
      keyframeCount += clip.keyframes.length;
      if (keyframeCount > TIMELINE_VALIDATION_LIMITS.keyframesTotal) return null;
      clipIds.add(clip.id);
    }
    tracks.push(track);
  }
  const transitions = schemaVersion === TIMELINE_SCHEMA_VERSION ? parseTransitions(value.transitions, tracks) : [];
  if (transitions === null) return null;
  // Absent is the same as none: every project written before titles existed has
  // no such key, and must still open rather than be reported as corrupt.
  const titles = schemaVersion === TIMELINE_SCHEMA_VERSION ? parseTitles(value.titles) : [];
  if (titles === null) return null;
  // The key is left off when there is nothing in it, so a document that had no
  // titles is written back exactly as it came: absent and empty already mean the
  // same thing to every reader, and inventing the key would rewrite files that
  // did not change.
  return titles.length === 0
    ? { schemaVersion: TIMELINE_SCHEMA_VERSION, tracks, transitions }
    : { schemaVersion: TIMELINE_SCHEMA_VERSION, tracks, transitions, titles };
}

export function parseTimelineDocument(value: unknown): TimelineDocument | null {
  return parseDocument(value, TIMELINE_SCHEMA_VERSION, parseCurrentTrack);
}

export function migrateTimelineDocumentV1(value: unknown): TimelineDocument | null {
  return parseDocument(value, 1, legacyTrackParser(parseTimelineClipV1));
}

export function migrateTimelineDocumentV2(value: unknown): TimelineDocument | null {
  return parseDocument(value, 2, legacyTrackParser(parseTimelineClipV2));
}
