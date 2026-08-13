import { timelineDurationMs } from './timelineLogic';
import type { TimelineDocument } from './timelineTypes';

/**
 * A platform-neutral description of what a timeline renders to.
 *
 * `compileFfmpegTimeline` produces a filter_complex string, which is FFmpeg's
 * vocabulary and no one else's. AVFoundation builds an AVMutableComposition and
 * Media3 builds an EditedMediaItemSequence; neither can read that string. What
 * both need is the same underlying facts — which source, which part of it, where
 * on the timeline, and in what layer — so those are stated once here and each
 * pipeline builds its own graph from them.
 *
 * Pure, like the rest of the shared core: it maps a document to a description
 * and renders nothing.
 */

export type CompositionSegment = {
  /** Index into the plan's `sources`, not a path — paths belong to the host. */
  readonly sourceIndex: number;
  /** Where this segment starts in the finished video. */
  readonly timelineStartMs: number;
  /** The slice taken from the source. */
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly opacity: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotationDegrees: number;
};

export type AudioSegment = {
  readonly sourceIndex: number;
  readonly timelineStartMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  /** Linear gain, already folded from the track mix and the clip's volume. */
  readonly gain: number;
};

export type CompositionPlan = {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationMs: number;
  /** Asset ids in the order the segments index into. */
  readonly sources: readonly string[];
  /**
   * Indexes into `sources` that are stills.
   *
   * A still is held for its clip's length rather than seeked into, and a
   * renderer that opens one as a movie gets a single frame. The plan is built
   * from the timeline alone, which does not record what an asset is, so the
   * caller supplies the kinds and the plan passes on the conclusion.
   */
  readonly stillSourceIndexes: readonly number[];
  /**
   * Bottom layer first. Track order is layer order and the timeline's first
   * track is the topmost, so this is the reverse of document order — the same
   * inversion the FFmpeg overlay chain needs, for the same reason.
   */
  readonly videoSegments: readonly CompositionSegment[];
  readonly audioSegments: readonly AudioSegment[];
};

export class CompositionPlanError extends Error {
  override readonly name = 'CompositionPlanError';
}

function decibelsToGain(gainDb: number): number {
  return 10 ** (gainDb / 20);
}

export function buildCompositionPlan(input: {
  readonly timeline: TimelineDocument;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Ids of assets that are stills; absent means none, as older projects have. */
  readonly stillAssetIds?: ReadonlySet<string>;
}): CompositionPlan {
  const durationMs = timelineDurationMs(input.timeline);
  if (durationMs <= 0) {
    throw new CompositionPlanError('Timeline has no media to export.');
  }

  const sources: string[] = [];
  const sourceIndexFor = (assetId: string): number => {
    const existing = sources.indexOf(assetId);
    if (existing !== -1) return existing;
    sources.push(assetId);
    return sources.length - 1;
  };

  const videoLayers: CompositionSegment[][] = [];
  const audioSegments: AudioSegment[] = [];

  for (const track of input.timeline.tracks) {
    if (track.kind === 'video') {
      const layer: CompositionSegment[] = [];
      for (const clip of track.clips) {
        // A fully transparent or zero-scaled clip contributes nothing; dropping
        // it here keeps both pipelines from compositing an invisible layer.
        if (clip.effects.opacity <= 0 || clip.effects.scale <= 0) continue;
        layer.push({
          sourceIndex: sourceIndexFor(clip.assetId),
          timelineStartMs: clip.timelineStartMs,
          sourceStartMs: clip.sourceStartMs,
          sourceEndMs: clip.sourceEndMs,
          opacity: clip.effects.opacity,
          scale: clip.effects.scale,
          offsetX: clip.effects.positionX,
          offsetY: clip.effects.positionY,
          rotationDegrees: clip.effects.rotation
        });
      }
      videoLayers.push(layer);
      continue;
    }

    const trackGain = decibelsToGain(track.mix.gainDb);
    for (const clip of track.clips) {
      audioSegments.push({
        sourceIndex: sourceIndexFor(clip.assetId),
        timelineStartMs: clip.timelineStartMs,
        sourceStartMs: clip.sourceStartMs,
        sourceEndMs: clip.sourceEndMs,
        // Muting the track wins over the clip's own volume, as it does in the
        // editor: a muted track is a decision about the whole track.
        gain: track.mix.muted ? 0 : trackGain * clip.effects.volume
      });
    }
  }

  return {
    width: input.width,
    height: input.height,
    frameRate: input.frameRate,
    durationMs,
    sources,
    stillSourceIndexes: sources
      .map((assetId, index) => (input.stillAssetIds?.has(assetId) === true ? index : -1))
      .filter((index) => index !== -1),
    // Bottom row first, so a pipeline that stacks in order puts the timeline's
    // top track on top.
    videoSegments: [...videoLayers].reverse().flat(),
    audioSegments
  };
}
