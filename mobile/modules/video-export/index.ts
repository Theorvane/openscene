import { requireOptionalNativeModule } from 'expo-modules-core';

import type { ExportMeasurement } from '@openvideo/shared/exportReview';

/**
 * Renders a composition plan to a file.
 *
 * The plan is built by src/shared/videoCompositionPlan; this module only turns
 * it into the platform's own composition object. Nothing about the timeline
 * rules lives on the native side.
 */
export type NativeSegment = {
  uri: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  /**
   * A still, to be held for the segment rather than read as a movie.
   *
   * Sent whether or not the renderer reads it: a build that ignores the field
   * is exactly the build `supportsStills` reports `false` for, and export
   * refuses those before they get here. Sending it anyway means the native side
   * is the only thing left to write.
   */
  still?: boolean;
};

export type NativeExportRequest = {
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  /** Bottom layer first. */
  videoSegments: NativeSegment[];
  audioSegments: (NativeSegment & { gain: number })[];
  /**
   * Transitions, as black over the finished picture: total at the midpoint,
   * gone at either end.
   *
   * Older builds of the native module ignore a key they do not know, which is
   * the right way for this to degrade — an export without the dip rather than
   * no export at all.
   */
  dips?: { startMs: number; durationMs: number }[];
  /**
   * Words over the finished picture.
   *
   * Geometry is in output-frame pixels measured from the centre, the same
   * convention a clip's `offsetX/Y` uses, so a number means the same distance
   * whichever renderer draws it.
   */
  titles: NativeTitle[];
};

export type NativeTitle = {
  text: string;
  timelineStartMs: number;
  timelineEndMs: number;
  sizePx: number;
  /** `#rrggbb`. */
  color: string;
  positionX: number;
  positionY: number;
};

export type NativeExportResult = { uri: string; durationMs: number };

/** A still pulled from a clip, in the shape the provider APIs accept. */
export type NativeFrame = { base64: string; mimeType: string; atMs: number };

type VideoExportModuleType = {
  readonly isSupported: boolean;
  /**
   * Whether the renderer can hold a still for a segment.
   *
   * A still has no timeline of its own, so a compositor that opens every source
   * as a movie gets one frame — the export would come out shorter than the cut
   * and nothing would say why. Absent means no, which is what every build made
   * before stills existed means.
   */
  readonly supportsStills?: boolean;
  /**
   * Whether two clips covering the same moment are composited rather than
   * queued one after the other.
   *
   * Absent means no, which is what every build made before this was asked
   * means — and no is also the honest answer for the Android renderer.
   */
  readonly supportsLayeredVideo?: boolean;
  exportComposition(request: NativeExportRequest): Promise<NativeExportResult>;
  /** Negative `atMs` means the last frame. */
  extractFrame(uri: string, atMs: number): Promise<NativeFrame>;
  /**
   * One peak per bar for a clip's window, each 0–1.
   *
   * Empty when the file will not decode, which is a clip drawn the way it was
   * before waveforms existed rather than an error anyone can act on.
   */
  readAudioPeaks(uri: string, startMs: number, endMs: number, bars: number): Promise<number[]>;
  /**
   * What a finished file measures, for checking an export against the cut.
   *
   * Null when the file will not open, which the shared review reports as
   * unchecked rather than as a fault.
   */
  describeVideo(uri: string): Promise<ExportMeasurement | null>;
};

/**
 * Optional on purpose. This is a local native module, so a client that was not
 * built with it — Expo Go, or any older build — has no way to provide it.
 * Requiring it outright threw at import time and took the whole app down with
 * it, which turned "export is unavailable" into "the editor will not open".
 */
const nativeModule = requireOptionalNativeModule<VideoExportModuleType>('VideoExport');

export const isExportAvailable = nativeModule !== null;

/**
 * Reported by the native side rather than assumed from the module's presence:
 * a client built before stills can render everything else perfectly well, and
 * refusing its exports outright would be worse than refusing the ones it would
 * get wrong.
 */
export const areStillsRenderable = nativeModule?.supportsStills === true;

/**
 * Reported by the renderer rather than assumed from the platform, for the same
 * reason stills are: what a build can do is a fact about that build. False on
 * Android, where a second sequence is not drawn, and the shared preflight
 * refuses the cut before the export rather than dropping a layer inside it.
 */
export const areLayersComposited = nativeModule?.supportsLayeredVideo === true;

/**
 * Frame extraction landed after export, so a dev client built before it has the
 * module but not the function. Checking for the function itself rather than the
 * module keeps continuity from failing with a confusing native error on a build
 * that is otherwise fine.
 */
export const isFrameExtractionAvailable =
  nativeModule !== null && typeof nativeModule.extractFrame === 'function';

export default {
  isSupported: nativeModule?.isSupported ?? false,
  async exportComposition(request: NativeExportRequest): Promise<NativeExportResult> {
    if (nativeModule === null) {
      throw new Error(
        'This build has no video export module. Run the app from a development build rather than Expo Go.'
      );
    }
    return nativeModule.exportComposition(request);
  },
  async extractFrame(uri: string, atMs: number): Promise<NativeFrame> {
    if (nativeModule === null || typeof nativeModule.extractFrame !== 'function') {
      throw new Error('This build cannot read frames out of a clip. Rebuild the development client.');
    }
    return nativeModule.extractFrame(uri, atMs);
  },
  /**
   * Null on a build made before the file was ever read back, which is a
   * missing check rather than a broken export — see `reviewExport`.
   */
  async describeVideo(uri: string): Promise<ExportMeasurement | null> {
    if (nativeModule === null || typeof nativeModule.describeVideo !== 'function') return null;
    try {
      return await nativeModule.describeVideo(uri);
    } catch {
      // A file the platform will not open is unchecked, not condemned.
      return null;
    }
  },
  async readAudioPeaks(uri: string, startMs: number, endMs: number, bars: number): Promise<number[]> {
    // Empty rather than an error: a build without the reader draws the clip the
    // way every build did before waveforms, which is a missing decoration and
    // not a broken editor.
    if (nativeModule === null || typeof nativeModule.readAudioPeaks !== 'function') return [];
    return nativeModule.readAudioPeaks(uri, startMs, endMs, bars);
  }
} satisfies VideoExportModuleType;
