import { buildCompositionPlan, CompositionPlanError } from '@openvideo/shared/videoCompositionPlan';
import type { CompositionSegment } from '@openvideo/shared/videoCompositionPlan';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import * as Sharing from 'expo-sharing';
import VideoExport, { areStillsRenderable } from '../../modules/video-export';
import type { EditorAsset } from './editorState';

/**
 * The photo library, loaded where it is used rather than at import.
 *
 * `expo-media-library` resolves a native module — `ExpoMediaLibraryNext` — that
 * a client without it cannot provide, and a top-level `import` of it threw while
 * the module graph was still loading. That is not a failed save: it is thrown
 * before any screen mounts, so the entire app dies on a red screen and the
 * fallback below never gets the chance to run. `modules/video-export` is
 * required optionally for exactly this reason; this import was the one that had
 * been missed.
 */
function loadMediaLibrary(): typeof import('expo-media-library') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-media-library') as typeof import('expo-media-library');
  } catch {
    return null;
  }
}

export type ExportOutcome =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly message: string };

/**
 * Turns the timeline into a plan, resolves asset ids to the local URIs the
 * native side needs, and hands it over. The plan is shared with the desktop; the
 * id-to-URI step is the only part that is the app's own, because a URI is a host
 * concern the timeline model deliberately does not carry.
 */
export async function exportTimeline(input: {
  readonly timeline: TimelineDocument;
  readonly assets: readonly EditorAsset[];
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
}): Promise<ExportOutcome> {
  let plan;
  try {
    plan = buildCompositionPlan({
      timeline: input.timeline,
      // The plan is built from the timeline, which does not record what an asset
      // is. Without this the native renderer opens a still as a movie.
      stillAssetIds: new Set(input.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id)),
      // A video clip's own sound, which used to be dropped: a cut came out
      // silent unless someone had separately placed an audio clip.
      //
      // This is a kind, and a video can perfectly well be silent — so it is a
      // proposal rather than a fact. The native renderer checks each file before
      // using its audio, which is the only place the answer actually lives.
      audibleAssetIds: new Set(input.assets.filter((asset) => asset.kind !== 'image').map((asset) => asset.id)),
      width: input.width ?? 1920,
      height: input.height ?? 1080,
      frameRate: input.frameRate ?? 30
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof CompositionPlanError ? error.message : 'The timeline could not be prepared for export.'
    };
  }

  // A renderer that cannot hold a still would open it as a movie and contribute
  // a single frame, so the export would be shorter than the timeline with
  // nothing to say why. Refusing names the limit instead.
  if (plan.stillSourceIndexes.length > 0 && !areStillsRenderable) {
    return {
      ok: false,
      message:
        `This build cannot render stills — ${plan.stillSourceIndexes.length} on the timeline. ` +
        'Remove them, or rebuild the development client once still rendering lands.'
    };
  }

  const uris = plan.sources.map((assetId) => input.assets.find((asset) => asset.id === assetId)?.uri);
  const missing = plan.sources.filter((_, index) => uris[index] === undefined);
  if (missing.length > 0) {
    // Exporting with a source silently dropped would produce a shorter video
    // than the timeline shows, which is worse than refusing.
    return { ok: false, message: `${missing.length} clip source(s) are no longer available on this device.` };
  }

  type Placed = {
    readonly sourceIndex: number;
    readonly timelineStartMs: number;
    readonly sourceStartMs: number;
    readonly sourceEndMs: number;
  };

  const stillSources = new Set(plan.stillSourceIndexes);
  const withUri = (segment: Placed) => ({
    uri: uris[segment.sourceIndex] as string,
    timelineStartMs: segment.timelineStartMs,
    sourceStartMs: segment.sourceStartMs,
    sourceEndMs: segment.sourceEndMs,
    still: stillSources.has(segment.sourceIndex)
  });

  /*
    What Adjust set, carried through to the renderer.

    The shared plan computes these and the desktop honours all of them, but this
    bridge used to forward position and timing only — so opacity and scale were
    dropped here, before any native module could have applied them. A control
    that changes a stored number and nothing a user can see is worse than one
    that is absent, and this is where the values were being lost.
  */
  const withEffects = (segment: CompositionSegment) => ({
    ...withUri(segment),
    opacity: segment.opacity,
    scale: segment.scale,
    offsetX: segment.offsetX,
    offsetY: segment.offsetY,
    rotationDegrees: segment.rotationDegrees
  });

  try {
    const result = await VideoExport.exportComposition({
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      durationMs: plan.durationMs,
      videoSegments: plan.videoSegments.map(withEffects),
      audioSegments: plan.audioSegments.map((segment) => ({ ...withUri(segment), gain: segment.gain })),
      // Transitions, already reduced by the plan to the black they put on the
      // frame. Forwarded rather than derived here: the bridge dropping what the
      // plan computed is exactly how the clip effects went missing.
      dips: plan.dips.map((dip) => ({ startMs: dip.startMs, durationMs: dip.durationMs }))
    });
    return { ok: true, uri: result.uri };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Export failed.' };
  }
}

export type DeliveryOutcome =
  | { readonly ok: true; readonly how: 'photos' | 'share' }
  | { readonly ok: false; readonly message: string };

/**
 * Hands the finished file to the user.
 *
 * An export that stops at a temporary path is not an export on a phone — there
 * is no file manager to go and find it in. Saving to the photo library is the
 * outcome people expect; the share sheet is the fallback when they decline that
 * permission, since refusing photo access should not mean losing the render.
 */
export async function deliverExport(uri: string): Promise<DeliveryOutcome> {
  const mediaLibrary = loadMediaLibrary();
  try {
    if (mediaLibrary !== null) {
      const permission = await mediaLibrary.requestPermissionsAsync();
      if (permission.granted) {
        await mediaLibrary.saveToLibraryAsync(uri);
        return { ok: true, how: 'photos' };
      }
    }
  } catch {
    // Fall through to sharing rather than failing: the render exists either way.
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'The video was rendered but this device offers no way to save or share it.' };
    }
    await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
    return { ok: true, how: 'share' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The video could not be shared.' };
  }
}
