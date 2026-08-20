import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CLIP_EFFECT_RANGES } from '../src/shared/timelineTypes';

/**
 * Straightening a clip, and moving it in the frame.
 *
 * `rotation`, `positionX` and `positionY` have been on every clip since clip
 * effects existed; all three renderers apply them and the desktop inspector
 * edits them. The phone had no control for any of them, so two ordinary tasks —
 * fixing footage shot sideways, and moving a scaled-up clip out from behind a
 * caption — could only be done on a desktop.
 */

const read = () => readFile(new URL('../mobile/src/screens/EditScreen.tsx', import.meta.url), 'utf8');

describe('the phone can place a clip in the frame', () => {
  it('offers rotation and both axes', async () => {
    const screen = await read();
    expect(screen).toContain('label="Rotate"');
    expect(screen).toContain('positionX: nudge(');
    expect(screen).toContain('positionY: nudge(');
  });

  it('turns in quarter turns, which is what fixes sideways footage', async () => {
    const screen = await read();
    expect(screen).toContain('turn(selected.clip.effects.rotation, 90)');
    expect(screen).toContain('turn(selected.clip.effects.rotation, -90)');
  });

  it('wraps rather than stopping at either end', async () => {
    // 360 is the same picture as 0, so a control that refused the fourth tap
    // after three would read as broken.
    const screen = await read();
    expect(screen).toMatch(/function turn\([\s\S]{0,200}% 360/);
  });

  it('nudges in the units the renderers already mean', async () => {
    // Output-frame pixels: 40 here is 40 in the exported file.
    const screen = await read();
    expect(screen).toContain('const POSITION_STEP_PX = 40');
    expect(screen).toMatch(/function nudge\([\s\S]{0,220}CLIP_EFFECT_RANGES\.positionX/);
  });

  it('is held inside what a document may store', () => {
    // The nudge clamps to the same range the validators enforce, so a long press
    // cannot walk a clip into a value that would be refused on the next open.
    expect(CLIP_EFFECT_RANGES.positionX.min).toBeLessThan(0);
    expect(CLIP_EFFECT_RANGES.positionX.max).toBeGreaterThan(0);
  });
});

/**
 * The renderer that had to catch up.
 *
 * Adding the control turned up a refusal: Android threw
 * `ERR_UNSUPPORTED_OFFSET` for any clip moved off centre, so the new control
 * guaranteed a failed export. Refusing loudly was right while nothing could
 * render it; shipping a control that always ends in that refusal is not.
 *
 * Media3 has no translate effect, and it does not need one. Scale was already
 * expressed as a crop — the window that ends up filling the output — and moving
 * that window is the same statement read the other way round.
 */
describe('an offset clip on Android', () => {
  const readKotlin = () =>
    readFile(
      new URL('../mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt', import.meta.url),
      'utf8'
    );

  it('is rendered rather than refused', async () => {
    const kotlin = await readKotlin();
    expect(kotlin).not.toContain('ERR_UNSUPPORTED_OFFSET');
    expect(kotlin).toContain('Crop(-halfX - shiftX, halfX - shiftX, -halfY + shiftY, halfY + shiftY)');
  });

  it('converts output pixels into the coordinates the effect takes', async () => {
    // The plan measures offsets in output pixels with y growing downward, the
    // way `overlay` does on the desktop; NDC is half-frames with y growing up.
    const kotlin = await readKotlin();
    expect(kotlin).toContain('segment.offsetX / (width / 2f)');
    expect(kotlin).toContain('segment.offsetY / (height / 2f)');
  });
});
