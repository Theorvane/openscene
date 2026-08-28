/**
 * Looking at the cut before the render starts.
 *
 * The finished file is read back and compared with what was promised
 * (`exportReview`). This is the other half: the reasons an export would not
 * come out right, found before anything is rendered rather than discovered
 * partway through it, or not at all.
 *
 * Each of these was a separate late failure with its own wording. Two video
 * clips over the same moment failed inside the Android renderer once the export
 * was already running; a clip whose range ran past the end of its file produced
 * a frozen tail and said nothing; a missing asset failed in staging on one
 * surface and in URI resolution on the other. They are one question — can this
 * renderer make this cut — so they are asked in one place, and both surfaces
 * refuse with the same sentence.
 *
 * What a renderer can do is passed in rather than assumed. A phone build made
 * before stills could be rendered is a real thing someone is holding, and the
 * honest answer for it is a refusal that names the limit.
 */

import { clipTimelineEndMs } from './timelineClipGeometry';
import type { MediaAsset, TimelineDocument } from './timelineTypes';

export type ExportCapabilities = {
  /** Whether a photograph can be held for its clip rather than opened as a movie. */
  readonly stills: boolean;
  /** Whether two clips covering the same moment are composited rather than queued. */
  readonly layeredVideo: boolean;
};

export type PreflightProblemKind = 'empty' | 'missing-asset' | 'past-source-end' | 'stills' | 'layered-video';

export type PreflightProblem = {
  readonly kind: PreflightProblemKind;
  /** A sentence for a person, naming what to do about it where there is something. */
  readonly detail: string;
};

export type PreflightInput = {
  readonly timeline: TimelineDocument;
  readonly assets: readonly MediaAsset[];
  readonly capabilities: ExportCapabilities;
};

/**
 * A frame or two past the end of a file is the last frame's own length and the
 * rounding a container does, not a mistake anyone made.
 */
const SOURCE_END_TOLERANCE_MS = 100;

function overlapping(clips: readonly { timelineStartMs: number; timelineEndMs: number }[]): boolean {
  const ordered = [...clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
  return ordered.some((clip, index) => index > 0 && clip.timelineStartMs < ordered[index - 1]!.timelineEndMs);
}

export function preflightExport(input: PreflightInput): readonly PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const videoTracks = input.timeline.tracks.filter((track) => track.kind === 'video');
  const allClips = input.timeline.tracks.flatMap((track) => track.clips);

  if (allClips.length === 0) {
    // Nothing else said about an empty timeline would mean anything.
    return [{ kind: 'empty', detail: 'There is nothing on the timeline to export.' }];
  }

  const missing = [...new Set(allClips.map((clip) => clip.assetId).filter((assetId) => !assetsById.has(assetId)))];
  if (missing.length > 0) {
    problems.push({
      kind: 'missing-asset',
      detail:
        `${missing.length} ${missing.length === 1 ? 'clip points' : 'clips point'} at media this project no longer has. ` +
        'Import it again, or remove those clips.'
    });
  }

  /*
    A clip that runs past the end of its own file.

    The renderers do not agree on what this produces — a frozen last frame, a
    segment shorter than its clip — and neither says anything about it. Both are
    wrong against the cut, which is why this is refused rather than trimmed:
    silently shortening someone's clip is a different edit from the one they
    made.
  */
  const pastEnd = allClips.filter((clip) => {
    const asset = assetsById.get(clip.assetId);
    const durationMs = asset?.metadata?.durationMs;
    // A still has no length of its own and is held for its clip, and an asset
    // whose length was never probed is not evidence of anything.
    return (
      asset !== undefined &&
      asset.kind !== 'image' &&
      typeof durationMs === 'number' &&
      durationMs > 0 &&
      clip.sourceEndMs > durationMs + SOURCE_END_TOLERANCE_MS
    );
  });
  if (pastEnd.length > 0) {
    const worst = pastEnd.reduce((left, right) => (right.sourceEndMs > left.sourceEndMs ? right : left));
    const overshootMs = worst.sourceEndMs - (assetsById.get(worst.assetId)?.metadata?.durationMs ?? 0);
    problems.push({
      kind: 'past-source-end',
      detail:
        `${pastEnd.length} ${pastEnd.length === 1 ? 'clip runs' : 'clips run'} past the end of the file behind ${pastEnd.length === 1 ? 'it' : 'them'} — ` +
        `the longest by ${(overshootMs / 1_000).toFixed(2)}s. Trim ${pastEnd.length === 1 ? 'it' : 'them'} back to the media.`
    });
  }

  if (!input.capabilities.stills) {
    const stills = allClips.filter((clip) => assetsById.get(clip.assetId)?.kind === 'image');
    if (stills.length > 0) {
      problems.push({
        kind: 'stills',
        detail:
          `This build cannot render stills — ${stills.length} on the timeline. ` +
          'Remove them, or rebuild the development client once still rendering lands.'
      });
    }
  }

  if (!input.capabilities.layeredVideo) {
    /*
      Two video clips over the same moment.

      A renderer that queues rather than composites plays one after the other,
      or drops one — which was found on a device, as a layer that simply was
      not in the file. Refusing before the render is the same answer, arriving
      when it is still useful.
    */
    const layered =
      videoTracks.filter((track) => track.clips.length > 0).length > 1 &&
      videoTracks.flatMap((track) => track.clips).length > 1 &&
      overlapping(
        videoTracks.flatMap((track) =>
          // The end is computed rather than stored, because a retimed clip
          // occupies more or less of the timeline than its source span.
          track.clips.map((clip) => ({ timelineStartMs: clip.timelineStartMs, timelineEndMs: clipTimelineEndMs(clip) }))
        )
      );
    if (layered) {
      problems.push({
        kind: 'layered-video',
        detail:
          'Two video clips cover the same moment, and this renderer cannot composite them. ' +
          'Put them on one track so they follow each other, or export on the desktop.'
      });
    }
  }

  return problems;
}

/** One line for a person, whatever the preflight found. */
export function preflightSummary(problems: readonly PreflightProblem[]): string {
  if (problems.length === 0) return 'The cut is ready to render.';
  return problems.map((problem) => problem.detail).join(' ');
}
