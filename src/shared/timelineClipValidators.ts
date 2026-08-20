import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS } from './timelineTypes';
import type { ClipEffects, PersistedTimelineClip, TimelineClip } from './timelineTypes';
import { parseClipKeyframes } from './timelineMetadataValidators';
import {
  getFiniteNonNegative,
  getOpaqueId,
  hasAllowedKeys,
  isPlainRecord
} from './timelineValidationPrimitives';

type ClipTiming = Omit<TimelineClip, 'effects'>;

function getBoundedNumber(record: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function parseClipEffects(value: unknown): ClipEffects | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['opacity', 'scale', 'positionX', 'positionY', 'rotation', 'volume', 'speed', 'brightness', 'contrast', 'saturation'])) {
    return null;
  }
  const opacity = getBoundedNumber(value, 'opacity', CLIP_EFFECT_RANGES.opacity.min, CLIP_EFFECT_RANGES.opacity.max);
  const scale = getBoundedNumber(value, 'scale', CLIP_EFFECT_RANGES.scale.min, CLIP_EFFECT_RANGES.scale.max);
  const positionX = getBoundedNumber(value, 'positionX', CLIP_EFFECT_RANGES.positionX.min, CLIP_EFFECT_RANGES.positionX.max);
  const positionY = getBoundedNumber(value, 'positionY', CLIP_EFFECT_RANGES.positionY.min, CLIP_EFFECT_RANGES.positionY.max);
  const rotation = getBoundedNumber(value, 'rotation', CLIP_EFFECT_RANGES.rotation.min, CLIP_EFFECT_RANGES.rotation.max);
  const volume = getBoundedNumber(value, 'volume', CLIP_EFFECT_RANGES.volume.min, CLIP_EFFECT_RANGES.volume.max);
  /*
    Speed is optional, and the two ways it can be absent mean different things.

    Not present at all is every project written before speed existed, and reads
    as 1 — the key stays off so the document round-trips unchanged. Present but
    out of range is a document claiming something the editor cannot render, and
    that is refused like any other bad effect rather than quietly clamped.
  */
  const hasSpeed = value.speed !== undefined;
  const speed = hasSpeed
    ? getBoundedNumber(value, 'speed', CLIP_EFFECT_RANGES.speed.min, CLIP_EFFECT_RANGES.speed.max)
    : null;

  /*
    Colour, on the same terms as speed: absent stays absent so the document
    round-trips, and present-but-impossible is refused rather than clamped.
  */
  const colour: { -readonly [K in 'brightness' | 'contrast' | 'saturation']?: number } = {};
  for (const key of ['brightness', 'contrast', 'saturation'] as const) {
    if (value[key] === undefined) continue;
    const range = CLIP_EFFECT_RANGES[key];
    const parsed = getBoundedNumber(value, key, range.min, range.max);
    if (parsed === null) return null;
    colour[key] = parsed;
  }
  if (opacity === null || scale === null || positionX === null || positionY === null || rotation === null || volume === null) {
    return null;
  }
  if (hasSpeed && speed === null) return null;
  const base = { opacity, scale, positionX, positionY, rotation, volume, ...colour };
  return speed === null ? base : { ...base, speed };
}

function parseClipTiming(value: Record<string, unknown>): ClipTiming | null {
  const id = getOpaqueId(value, 'id');
  const assetId = getOpaqueId(value, 'assetId');
  const timelineStartMs = getFiniteNonNegative(value, 'timelineStartMs');
  const sourceStartMs = getFiniteNonNegative(value, 'sourceStartMs');
  const sourceEndMs = getFiniteNonNegative(value, 'sourceEndMs');
  const sourceDurationMs = getFiniteNonNegative(value, 'sourceDurationMs');
  if (
    id === null ||
    assetId === null ||
    timelineStartMs === null ||
    sourceStartMs === null ||
    sourceEndMs === null ||
    sourceDurationMs === null ||
    sourceEndMs <= sourceStartMs ||
    sourceEndMs > sourceDurationMs
  ) {
    return null;
  }
  return { id, assetId, timelineStartMs, sourceStartMs, sourceEndMs, sourceDurationMs };
}

export function parseTimelineClip(value: unknown): PersistedTimelineClip | null {
  if (
    !isPlainRecord(value) ||
    !hasAllowedKeys(value, ['id', 'assetId', 'timelineStartMs', 'sourceStartMs', 'sourceEndMs', 'sourceDurationMs', 'effects', 'keyframes'])
  ) {
    return null;
  }
  const timing = parseClipTiming(value);
  const effects = parseClipEffects(value.effects);
  if (timing === null || effects === null) return null;
  const clip = { ...timing, effects, keyframes: [] };
  const keyframes = parseClipKeyframes(value.keyframes, clip);
  return keyframes === null ? null : { ...clip, keyframes };
}

export function parseTimelineClipV1(value: unknown): PersistedTimelineClip | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'assetId', 'timelineStartMs', 'sourceStartMs', 'sourceEndMs', 'sourceDurationMs'])) {
    return null;
  }
  const timing = parseClipTiming(value);
  return timing === null ? null : { ...timing, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] };
}

export function parseTimelineClipV2(value: unknown): PersistedTimelineClip | null {
  if (
    !isPlainRecord(value) ||
    !hasAllowedKeys(value, ['id', 'assetId', 'timelineStartMs', 'sourceStartMs', 'sourceEndMs', 'sourceDurationMs', 'effects'])
  ) return null;
  const timing = parseClipTiming(value);
  const effects = parseClipEffects(value.effects);
  return timing === null || effects === null ? null : { ...timing, effects, keyframes: [] };
}
