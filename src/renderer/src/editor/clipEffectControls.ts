import { CLIP_EFFECT_RANGES } from '../../../shared/timelineTypes';
import { clipColour, isGraded } from '../../../shared/clipColour';
import type { ClipEffects } from '../../../shared/timelineTypes';

const PERCENT_SCALE = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function effectUnitToPercent(value: number): number {
  return Math.round(value * PERCENT_SCALE);
}

export function effectPercentToOpacity(percent: number): ClipEffects['opacity'] {
  return clamp(percent / PERCENT_SCALE, CLIP_EFFECT_RANGES.opacity.min, CLIP_EFFECT_RANGES.opacity.max);
}

export function effectPercentToScale(percent: number): ClipEffects['scale'] {
  return clamp(percent / PERCENT_SCALE, CLIP_EFFECT_RANGES.scale.min, CLIP_EFFECT_RANGES.scale.max);
}

export function effectVolumeToDb(volume: number): number {
  const { min, max } = CLIP_EFFECT_RANGES.volumeDb;
  return Math.round(min + volume * (max - min));
}

export function effectDbToVolume(db: number): ClipEffects['volume'] {
  const { min, max } = CLIP_EFFECT_RANGES.volumeDb;
  return clamp((db - min) / (max - min), CLIP_EFFECT_RANGES.volume.min, CLIP_EFFECT_RANGES.volume.max);
}

export function effectCssTransform(effects: ClipEffects): string {
  return `translate(${effects.positionX}px, ${effects.positionY}px) scale(${effects.scale}) rotate(${effects.rotation}deg)`;
}

/**
 * The grade, as a CSS filter for the program monitor.
 *
 * `brightness` is added in the plan and multiplied in CSS, so the preview shows
 * `1 + b` — the same picture by a different route. Empty when the clip is
 * neutral, which keeps the monitor free of a filter that does nothing.
 */
export function effectCssFilter(effects: ClipEffects): string | undefined {
  if (!isGraded(effects)) return undefined;
  const colour = clipColour(effects);
  return `brightness(${1 + colour.brightness}) contrast(${colour.contrast}) saturate(${colour.saturation})`;
}
