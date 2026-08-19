import { EXPORT_DEFAULTS } from './exportTypes';
import type { TimelineTitle } from './timelineTypes';

/**
 * Where a title lands on a preview, given that its numbers describe the export.
 *
 * A title's `sizePx`, `positionX` and `positionY` are output-frame pixels — that
 * is what FFmpeg's `drawtext`, Media3's `TextOverlay` and the iOS `CATextLayer`
 * are all handed. A preview is some other size entirely, usually much smaller,
 * so drawing those numbers straight onto it produces a caption that is right in
 * neither place: enormous in a small pane, and misleading about the file.
 *
 * So they are scaled by however much the frame was shrunk. `min` of the two
 * ratios rather than the height one alone, because a preview that does not
 * share the export's aspect letterboxes, and the visible picture is then the
 * smaller fit — scaling by height would push the words outside it.
 *
 * Shared for the usual reason: the same caption has to look the same on a phone
 * and on a desktop, and neither surface gets to invent its own idea of "big".
 */
export type TitlePreviewLayout = {
  readonly fontSizePx: number;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
};

export function titlePreviewLayout(
  title: TimelineTitle,
  frame: { readonly width: number; readonly height: number },
  reference: { readonly width: number; readonly height: number } = EXPORT_DEFAULTS
): TitlePreviewLayout {
  const scale =
    frame.width > 0 && frame.height > 0 && reference.width > 0 && reference.height > 0
      ? Math.min(frame.width / reference.width, frame.height / reference.height)
      : 0;
  return {
    fontSizePx: title.sizePx * scale,
    offsetXPx: title.positionX * scale,
    offsetYPx: title.positionY * scale
  };
}

/** The titles covering a moment, in the order they should be drawn. */
export function titlesAt(
  titles: readonly TimelineTitle[] | undefined,
  timeMs: number
): readonly TimelineTitle[] {
  return (titles ?? []).filter((title) => timeMs >= title.timelineStartMs && timeMs < title.timelineEndMs);
}
