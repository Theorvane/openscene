import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { handleWidthFor } from '../mobile/src/lib/timelineHandles';

/**
 * Where along a clip a touch means trim rather than move.
 *
 * The handles were a fixed 22pt at each end, and a clip is `pxPerSecond` wide —
 * so at the default zoom anything under about 1.6s was narrower than two of
 * them. The zones overlapped, the left edge is tested first, and every gesture
 * on a short clip became a left trim. Nothing could be moved and nothing said
 * why.
 */

const MOVE_ZONE = 24;

describe('trim handle width', () => {
  it('leaves a move zone at every width', () => {
    for (const width of [26, 28, 40, 56, 70, 120, 224, 900]) {
      const handle = handleWidthFor(width);
      const move = width - handle * 2;
      expect(move, `a ${width}px clip must still be draggable`).toBeGreaterThanOrEqual(Math.min(MOVE_ZONE, width));
    }
  });

  it('gives full-size handles once there is room for them', () => {
    // 22 + 24 + 22: the first width that fits both handles and a move zone.
    expect(handleWidthFor(68)).toBe(22);
    expect(handleWidthFor(224)).toBe(22);
  });

  it('shrinks the handles rather than the move zone', () => {
    // The old code kept the handles and lost the zone; this keeps the zone.
    expect(handleWidthFor(40)).toBeLessThan(22);
    expect(handleWidthFor(40)).toBeGreaterThan(0);
  });

  it('gives a clip too small for any handle entirely to moving', () => {
    // Length is still reachable from Adjust, so a clip this small is better
    // draggable than trimmable-and-nothing-else.
    expect(handleWidthFor(24)).toBe(0);
    expect(handleWidthFor(10)).toBe(0);
  });
});

describe('timeline gestures', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('states precedence over the scroller rather than racing it', async () => {
    // The same drag moved a clip once and scrolled the timeline the next time,
    // because PanResponder and Android's native scroll interception each
    // decided. Declaring it removes the race rather than tuning it.
    const clip = await read('src/components/TimelineClip.tsx');
    expect(clip).toContain('blocksExternalGesture(scrollGesture)');
    // The word survives in the comment explaining why it is gone; what must not
    // survive is the import.
    expect(clip).not.toMatch(/^import[^;]*PanResponder/m);

    const screen = await read('src/screens/EditScreen.tsx');
    expect(screen).toContain('Gesture.Native()');
    expect(screen).toContain('<GestureScrollView');
  });

  it('pins the track headers outside the horizontal scroller', async () => {
    // They used to scroll away, leaving clips at the screen edge with nothing
    // to say which track they were on.
    const screen = await read('src/screens/EditScreen.tsx');
    expect(screen).toMatch(/<View style={styles\.railColumn}>[\s\S]{0,4000}<\/View>\n\n\s+<GestureDetector gesture={laneScroll}>/);
  });

  it('lets a long press anywhere on a clip trim its right edge', async () => {
    const clip = await read('src/components/TimelineClip.tsx');
    // The delayed pan gets first refusal; a short drag makes it fail and keeps
    // the ordinary move/edge-trim pan immediate.
    expect(clip).toContain('const LONG_PRESS_TRIM_MS = 350;');
    expect(clip).toContain('.activateAfterLongPress(LONG_PRESS_TRIM_MS)');
    expect(clip).toContain("onTrim('right', clip.timelineStartMs + lengthMs + event.translationX / pxPerMs)");
    expect(clip).toContain('Gesture.Exclusive(longPressTrim, Gesture.Race(pan, tap))');
    expect(clip).toContain('width: Animated.add(Animated.add(width, rightStretch), Animated.multiply(leftStretch, -1))');
    expect(clip).toContain('translateX: Animated.add(offset, leftStretch)');
  });

  it('offers length and start as numbers', async () => {
    // Trimming was only possible by grabbing a 22pt edge, and zooming in to cut
    // precisely is what pushes that edge off screen.
    const screen = await read('src/screens/EditScreen.tsx');
    expect(screen).toContain('label="Length"');
    expect(screen).toContain('label="Start"');
  });
});
