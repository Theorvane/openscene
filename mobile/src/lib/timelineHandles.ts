/**
 * Where along a clip a touch means trim rather than move.
 *
 * Kept free of React Native so the rule can be tested. The handles used to be a
 * fixed 22pt at each end, and a clip is `pxPerSecond` wide — so at the default
 * zoom anything under about 1.6s was narrower than two of them. The zones
 * overlapped, the left edge is tested first, and every gesture on a short clip
 * became a left trim: nothing could be moved, and nothing said why.
 *
 * The handles give way instead. They shrink so a move zone always exists, and a
 * clip too small even for that is all move — its length is still reachable from
 * Adjust, so being draggable is the more useful of the two.
 */

export const HANDLE_WIDTH = 22;
export const MIN_CLIP_WIDTH = 26;
/** Below four fingers' worth there is no room for three zones. */
export const MIN_MOVE_ZONE = 24;

export function handleWidthFor(clipWidth: number): number {
  const spare = clipWidth - MIN_MOVE_ZONE;
  if (spare <= 0) return 0;
  return Math.min(HANDLE_WIDTH, spare / 2);
}
