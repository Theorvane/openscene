import { clipTimelineEndMs } from './timelineClipGeometry';
import { trackKindForAsset } from './timelineStills';
import type { MediaAsset, TimelineDocument, TimelineTrack } from './timelineTypes';

/**
 * Placement rules for callers that add a clip without a hand-picked track —
 * today the Edit Agent tools. The agent knows the asset it wants on the
 * timeline, not the project's track ids, so the target track is resolved from
 * the asset kind and the failure messages name the tracks that do exist.
 */
export type TimelineTrackTarget =
  | { readonly ok: true; readonly track: TimelineTrack }
  | { readonly ok: false; readonly error: string };

function describeTracks(timeline: TimelineDocument): string {
  if (timeline.tracks.length === 0) return 'the project has no tracks';
  return timeline.tracks.map((track) => `${track.id} (${track.kind})`).join(', ');
}

export function resolveTimelineTrackForAsset(
  timeline: TimelineDocument,
  asset: MediaAsset,
  requestedTrackId?: string | undefined
): TimelineTrackTarget {
  if (requestedTrackId !== undefined && requestedTrackId.length > 0) {
    const requested = timeline.tracks.find((track) => track.id === requestedTrackId);
    if (requested === undefined) {
      return { ok: false, error: `Track ${requestedTrackId} not found. Available tracks: ${describeTracks(timeline)}.` };
    }
    // A still asks for a video track, because that is where picture goes.
    if (requested.kind !== trackKindForAsset(asset.kind)) {
      return {
        ok: false,
        error: `Track ${requestedTrackId} is a ${requested.kind} track but asset ${asset.id} is ${asset.kind}. Available tracks: ${describeTracks(timeline)}.`
      };
    }
    return { ok: true, track: requested };
  }

  const wanted = trackKindForAsset(asset.kind);
  const match = timeline.tracks.find((track) => track.kind === wanted);
  if (match === undefined) {
    return {
      ok: false,
      error: `The project has no ${wanted} track for asset ${asset.id}. Available tracks: ${describeTracks(timeline)}.`
    };
  }
  return { ok: true, track: match };
}

/** Where a clip appended to this track starts, so added clips never overlap. */
export function trackAppendStartMs(track: TimelineTrack): number {
  return track.clips.reduce((end, clip) => Math.max(end, clipTimelineEndMs(clip)), 0);
}
