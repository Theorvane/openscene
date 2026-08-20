import { CLIP_EFFECT_RANGES } from './timelineTypes';
import type { ClipEffects } from './timelineTypes';

/**
 * A clip's colour, and whether it has any.
 *
 * `brightness` is added and the other two are multiplied, which is what every
 * grading control means by those words and what `eq` in FFmpeg, `Brightness`
 * and `Contrast` in Media3, and a Core Image colour matrix all take.
 *
 * The neutral answer matters as much as the graded one: neutral has to render
 * identically everywhere, because that is what lets a renderer without colour
 * still be correct for every clip nobody graded.
 */

export const NEUTRAL_COLOUR = Object.freeze({ brightness: 0, contrast: 1, saturation: 1 });

export type ClipColour = { readonly brightness: number; readonly contrast: number; readonly saturation: number };

export function clipColour(effects: ClipEffects | undefined): ClipColour {
  return {
    brightness: bounded(effects?.brightness, NEUTRAL_COLOUR.brightness, 'brightness'),
    contrast: bounded(effects?.contrast, NEUTRAL_COLOUR.contrast, 'contrast'),
    saturation: bounded(effects?.saturation, NEUTRAL_COLOUR.saturation, 'saturation')
  };
}

/** Whether anything would change if the grade were skipped. */
export function isGraded(effects: ClipEffects | undefined): boolean {
  const colour = clipColour(effects);
  return (
    colour.brightness !== NEUTRAL_COLOUR.brightness ||
    colour.contrast !== NEUTRAL_COLOUR.contrast ||
    colour.saturation !== NEUTRAL_COLOUR.saturation
  );
}

function bounded(value: number | undefined, fallback: number, key: 'brightness' | 'contrast' | 'saturation'): number {
  const range = CLIP_EFFECT_RANGES[key];
  // A stored value outside the range is a document the validators would have
  // refused; reaching one here means something bypassed them, and neutral is
  // the answer that cannot make a picture worse.
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
    ? value
    : fallback;
}
