import { EXPORT_DEFAULTS } from './exportTypes';
import type { MediaAsset, TimelineDocument } from './timelineTypes';

/**
 * The frame a cut is rendered into.
 *
 * A phone shoots upright, and this app exported everything into 1920×1080 —
 * so the ordinary case, a clip filmed portrait, came out pillarboxed with black
 * down both sides. The dimensions were never missing: every imported asset
 * records them, and the export simply did not ask.
 *
 * The default is the footage. A cut of one clip should come out the shape it
 * went in, and a person who wants something else says so; guessing "landscape,
 * probably" is how the black bars got there.
 *
 * Shared, because a project opened on a desktop must not silently change shape.
 */

export type FramePreference = 'source' | 'landscape' | 'portrait' | 'square';

export type OutputFrame = { readonly width: number; readonly height: number };

/** H.264 will not take odd dimensions, and a phone will not take a wall-sized one. */
const MAX_EDGE = 3_840;
const MIN_EDGE = 16;

function usable(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const even = Math.floor(value / 2) * 2;
  return even >= MIN_EDGE && even <= MAX_EDGE ? even : null;
}

/**
 * The first video clip's asset, in timeline order.
 *
 * First rather than largest or most common: a cut takes its shape from how it
 * opens, which is also the answer a person can predict without being told the
 * rule.
 */
function leadingVideoAsset(timeline: TimelineDocument, assets: readonly MediaAsset[]): MediaAsset | null {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const clips = timeline.tracks
    .filter((track) => track.kind === 'video')
    .flatMap((track) => track.clips)
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs);
  for (const clip of clips) {
    const asset = byId.get(clip.assetId);
    if (asset !== undefined && asset.kind !== 'audio') return asset;
  }
  return null;
}

export function outputFrameFor(input: {
  readonly timeline: TimelineDocument;
  readonly assets: readonly MediaAsset[];
  readonly preference?: FramePreference;
}): OutputFrame {
  const preference = input.preference ?? 'source';
  const source = sourceFrame(input.timeline, input.assets);

  switch (preference) {
    case 'source':
      return source;
    case 'landscape':
      return orient(source, 'wide');
    case 'portrait':
      return orient(source, 'tall');
    case 'square': {
      // The shorter edge, so nothing is invented: a square made from the longer
      // one would be asking the renderer to fill space the footage never had.
      const edge = usable(Math.min(source.width, source.height)) ?? EXPORT_DEFAULTS.height;
      return { width: edge, height: edge };
    }
    default:
      return source;
  }
}

function sourceFrame(timeline: TimelineDocument, assets: readonly MediaAsset[]): OutputFrame {
  const asset = leadingVideoAsset(timeline, assets);
  const width = usable(asset?.metadata?.width);
  const height = usable(asset?.metadata?.height);
  // Both or neither: half a frame from the footage and half from a default
  // would be a shape nothing was shot in.
  return width === null || height === null
    ? { width: EXPORT_DEFAULTS.width, height: EXPORT_DEFAULTS.height }
    : { width, height };
}

/**
 * The same frame, turned the way it was asked for.
 *
 * Turned rather than re-invented: a 1080×1920 clip asked for landscape becomes
 * 1920×1080, which is the frame it would have had if it had been filmed the
 * other way up — not a new resolution chosen out of the air.
 */
function orient(frame: OutputFrame, want: 'wide' | 'tall'): OutputFrame {
  const isWide = frame.width >= frame.height;
  if ((want === 'wide' && isWide) || (want === 'tall' && !isWide)) return frame;
  return { width: frame.height, height: frame.width };
}
