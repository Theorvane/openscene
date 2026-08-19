import { clipDurationMs, clipTimelineEndMs } from './timelineClipGeometry';
import {
  AUDIO_TRACK_MIX_RANGES,
  CLIP_EFFECT_PROPERTIES,
  CLIP_EFFECT_RANGES
} from './timelineTypes';
import type {
  AudioTrackMix,
  ClipEffectProperty,
  ClipKeyframe,
  PersistedTimelineClip,
  TimelineTrack,
  TransitionDescriptor,
  TimelineTitle,
  TransitionType
} from './timelineTypes';
import { TIMELINE_VALIDATION_LIMITS, getOpaqueId, hasAllowedKeys, isPlainRecord, isUnknownArray } from './timelineValidationPrimitives';

function getBoundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function getClipEffectProperty(value: unknown): ClipEffectProperty | null {
  if (value === 'opacity' || value === 'scale' || value === 'positionX' || value === 'positionY' || value === 'rotation' || value === 'volume') {
    return value;
  }
  return null;
}

function compareKeyframes(left: ClipKeyframe, right: ClipKeyframe): number {
  if (left.timelineTimeMs !== right.timelineTimeMs) return left.timelineTimeMs - right.timelineTimeMs;
  return left.property.localeCompare(right.property);
}

export function parseClipKeyframes(value: unknown, clip: PersistedTimelineClip): readonly ClipKeyframe[] | null {
  if (!isUnknownArray(value) || value.length > TIMELINE_VALIDATION_LIMITS.keyframesPerClip) return null;
  const keyframes: ClipKeyframe[] = [];
  const coordinates = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || !hasAllowedKeys(item, ['timelineTimeMs', 'property', 'value', 'interpolation'])) return null;
    const timelineTimeMs = getBoundedNumber(item.timelineTimeMs, clip.timelineStartMs, clipTimelineEndMs(clip));
    const property = getClipEffectProperty(item.property);
    const interpolation = item.interpolation === 'linear' ? item.interpolation : null;
    if (timelineTimeMs === null || property === null || interpolation === null) return null;
    const range = CLIP_EFFECT_RANGES[property];
    const keyframeValue = getBoundedNumber(item.value, range.min, range.max);
    const coordinate = `${timelineTimeMs}:${property}`;
    if (keyframeValue === null || coordinates.has(coordinate)) return null;
    coordinates.add(coordinate);
    keyframes.push({ timelineTimeMs, property, value: keyframeValue, interpolation });
  }
  return keyframes.sort(compareKeyframes);
}

export function isValidClipKeyframe(keyframe: ClipKeyframe, clip: PersistedTimelineClip): boolean {
  if (!CLIP_EFFECT_PROPERTIES.some((property) => property === keyframe.property) || keyframe.interpolation !== 'linear') return false;
  const range = CLIP_EFFECT_RANGES[keyframe.property];
  return (
    getBoundedNumber(keyframe.timelineTimeMs, clip.timelineStartMs, clipTimelineEndMs(clip)) !== null &&
    getBoundedNumber(keyframe.value, range.min, range.max) !== null
  );
}

export function sortClipKeyframes(keyframes: readonly ClipKeyframe[]): readonly ClipKeyframe[] {
  return [...keyframes].sort(compareKeyframes);
}

export function parseAudioTrackMix(value: unknown): AudioTrackMix | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['gainDb', 'pan', 'muted'])) return null;
  const gainDb = getBoundedNumber(value.gainDb, AUDIO_TRACK_MIX_RANGES.gainDb.min, AUDIO_TRACK_MIX_RANGES.gainDb.max);
  const pan = getBoundedNumber(value.pan, AUDIO_TRACK_MIX_RANGES.pan.min, AUDIO_TRACK_MIX_RANGES.pan.max);
  return gainDb === null || pan === null || typeof value.muted !== 'boolean' ? null : { gainDb, pan, muted: value.muted };
}

export function isValidAudioTrackMix(mix: AudioTrackMix): boolean {
  return (
    getBoundedNumber(mix.gainDb, AUDIO_TRACK_MIX_RANGES.gainDb.min, AUDIO_TRACK_MIX_RANGES.gainDb.max) !== null &&
    getBoundedNumber(mix.pan, AUDIO_TRACK_MIX_RANGES.pan.min, AUDIO_TRACK_MIX_RANGES.pan.max) !== null &&
    typeof mix.muted === 'boolean'
  );
}

function getTransitionType(value: unknown): TransitionType | null {
  if (value === 'fade' || value === 'crossfade' || value === 'dipToBlack') return value;
  return null;
}

export function transitionsAreValid(transitions: readonly TransitionDescriptor[], tracks: readonly TimelineTrack[]): boolean {
  const clipLocations = new Map<string, { readonly clip: PersistedTimelineClip; readonly track: TimelineTrack; readonly index: number }>();
  for (const track of tracks) {
    track.clips.forEach((clip, index) => clipLocations.set(clip.id, { clip, track, index }));
  }
  const consumedDurationByClip = new Map<string, number>();
  for (const transition of transitions) {
    const from = clipLocations.get(transition.fromClipId);
    const to = clipLocations.get(transition.toClipId);
    if (
      from === undefined ||
      to === undefined ||
      from.track !== to.track ||
      from.track.kind !== 'video' ||
      to.index !== from.index + 1 ||
      clipTimelineEndMs(from.clip) !== to.clip.timelineStartMs ||
      getTransitionType(transition.type) === null ||
      !Number.isFinite(transition.durationMs) ||
      transition.durationMs <= 0 ||
      transition.durationMs > clipDurationMs(from.clip) ||
      transition.durationMs > clipDurationMs(to.clip)
    ) return false;
    const fromConsumed = (consumedDurationByClip.get(from.clip.id) ?? 0) + transition.durationMs;
    const toConsumed = (consumedDurationByClip.get(to.clip.id) ?? 0) + transition.durationMs;
    if (fromConsumed > clipDurationMs(from.clip) || toConsumed > clipDurationMs(to.clip)) return false;
    consumedDurationByClip.set(from.clip.id, fromConsumed);
    consumedDurationByClip.set(to.clip.id, toConsumed);
  }
  return true;
}

export function parseTransitions(value: unknown, tracks: readonly TimelineTrack[]): readonly TransitionDescriptor[] | null {
  if (!isUnknownArray(value) || value.length > TIMELINE_VALIDATION_LIMITS.transitions) return null;
  const transitions: TransitionDescriptor[] = [];
  const pairs = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || !hasAllowedKeys(item, ['fromClipId', 'toClipId', 'type', 'durationMs'])) return null;
    const fromClipId = getOpaqueId(item, 'fromClipId');
    const toClipId = getOpaqueId(item, 'toClipId');
    const type = getTransitionType(item.type);
    const durationMs = item.durationMs;
    const pair = `${fromClipId}:${toClipId}`;
    if (fromClipId === null || toClipId === null || type === null || typeof durationMs !== 'number' || pairs.has(pair)) return null;
    pairs.add(pair);
    transitions.push({ fromClipId, toClipId, type, durationMs });
  }
  transitions.sort((left, right) => left.fromClipId.localeCompare(right.fromClipId) || left.toClipId.localeCompare(right.toClipId));
  return transitionsAreValid(transitions, tracks) ? transitions : null;
}

/** `#rrggbb` only: every renderer parses a colour differently, and a shared document cannot afford that. */
function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Titles, or nothing if any one of them is malformed.
 *
 * Absent is the same as none: every project written before titles existed has no
 * such key and must still open rather than be reported as corrupt. One bad title
 * rejects the document, the way one bad clip does — a half-read timeline is
 * worse than a refused one, because the half that survived gets written back
 * over the whole.
 */
export function parseTitles(value: unknown): readonly TimelineTitle[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const titles: TimelineTitle[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const title = candidate as Partial<TimelineTitle>;
    if (typeof title.id !== 'string' || title.id.length === 0) return null;
    if (typeof title.text !== 'string') return null;
    if (!Number.isFinite(title.timelineStartMs) || Number(title.timelineStartMs) < 0) return null;
    if (!Number.isFinite(title.timelineEndMs)) return null;
    // A title with no length is not a title; it is a value nothing can render.
    if (Number(title.timelineEndMs) <= Number(title.timelineStartMs)) return null;
    if (!Number.isFinite(title.sizePx) || Number(title.sizePx) <= 0) return null;
    if (!Number.isFinite(title.positionX) || !Number.isFinite(title.positionY)) return null;
    if (!isHexColor(title.color)) return null;
    titles.push({
      id: title.id,
      text: title.text,
      timelineStartMs: Number(title.timelineStartMs),
      timelineEndMs: Number(title.timelineEndMs),
      sizePx: Number(title.sizePx),
      color: title.color,
      positionX: Number(title.positionX),
      positionY: Number(title.positionY)
    });
  }
  return titles;
}
