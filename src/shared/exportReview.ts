/**
 * Reading the finished file back and comparing it with what was promised.
 *
 * An export used to be called a success because the encoder exited zero and a
 * file existed. Every serious export defect found on a device got past exactly
 * that: a cut truncated to a third of its length by a zero-sized title overlay,
 * a layer that was dropped without a word, a clip that came out silent because
 * its audio was never mapped. All of them exited zero and wrote a file.
 *
 * So the plan's promise is checked against the file's own measurements. This
 * module is only the comparison — measuring is each platform's own business,
 * because they have different tools for it, and the answer has to be the same
 * either way.
 */

/** What the composition plan said the file would be. */
export type ExportPromise = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly frameRate: number;
  readonly durationMs: number;
  /** Whether anything on the timeline was meant to be heard. */
  readonly hasSound: boolean;
};

/** What the finished file turned out to be. */
export type ExportMeasurement = {
  readonly widthPx: number;
  readonly heightPx: number;
  /** Absent when the container does not report one; a missing rate is not a fault. */
  readonly frameRate?: number | undefined;
  readonly durationMs: number;
  readonly hasSoundTrack: boolean;
};

export type ExportProblemKind = 'length' | 'frame' | 'frameRate' | 'sound' | 'empty';

export type ExportProblem = {
  readonly kind: ExportProblemKind;
  /** A sentence for a person, not a diff for a machine. */
  readonly detail: string;
};

export type ExportReview =
  /** Nothing could be measured — an honest gap, not a pass. */
  | { readonly checked: false; readonly why: string }
  | { readonly checked: true; readonly ok: boolean; readonly problems: readonly ExportProblem[] };

/**
 * How far off is still the same file.
 *
 * A container rounds, a frame rate is a ratio that will not divide, and the
 * last frame's length is a real millisecond or two. These are wide enough to
 * survive that and narrow enough to catch a truncated cut, which is the defect
 * that actually happened: a third of the length, not two frames of it.
 */
const LENGTH_TOLERANCE_MS = 250;
const LENGTH_TOLERANCE_RATIO = 0.02;
const FRAME_RATE_TOLERANCE_RATIO = 0.05;

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(2)}s`;
}

export function reviewExport(promise: ExportPromise, measurement: ExportMeasurement | null): ExportReview {
  if (measurement === null) {
    return { checked: false, why: 'The finished file could not be measured on this machine.' };
  }

  const problems: ExportProblem[] = [];

  if (measurement.durationMs <= 0 || measurement.widthPx <= 0 || measurement.heightPx <= 0) {
    // A file with no picture and no length is not a near miss to be measured
    // against tolerances; nothing else said about it would mean anything.
    return {
      checked: true,
      ok: false,
      problems: [{ kind: 'empty', detail: 'The finished file has no picture in it.' }]
    };
  }

  const lengthTolerance = Math.max(LENGTH_TOLERANCE_MS, promise.durationMs * LENGTH_TOLERANCE_RATIO);
  const lengthGap = Math.abs(measurement.durationMs - promise.durationMs);
  if (lengthGap > lengthTolerance) {
    const direction = measurement.durationMs < promise.durationMs ? 'shorter' : 'longer';
    problems.push({
      kind: 'length',
      detail: `The cut is ${seconds(promise.durationMs)} but the file is ${seconds(measurement.durationMs)} — ${direction} than it should be.`
    });
  }

  if (measurement.widthPx !== promise.widthPx || measurement.heightPx !== promise.heightPx) {
    problems.push({
      kind: 'frame',
      detail: `The frame should be ${promise.widthPx}x${promise.heightPx} and the file is ${measurement.widthPx}x${measurement.heightPx}.`
    });
  }

  if (measurement.frameRate !== undefined && promise.frameRate > 0) {
    const rateGap = Math.abs(measurement.frameRate - promise.frameRate) / promise.frameRate;
    if (rateGap > FRAME_RATE_TOLERANCE_RATIO) {
      problems.push({
        kind: 'frameRate',
        detail: `The file runs at ${measurement.frameRate.toFixed(2)} fps rather than ${promise.frameRate} fps.`
      });
    }
  }

  // Only one way round: a timeline with nothing to hear may still be written
  // with a silent track, and there is nothing wrong with that. Sound that was
  // meant to be there and is not is the defect.
  if (promise.hasSound && !measurement.hasSoundTrack) {
    problems.push({ kind: 'sound', detail: 'The timeline has sound on it and the file has none.' });
  }

  return { checked: true, ok: problems.length === 0, problems };
}

/** One line for a person, whatever the review turned out to be. */
export function exportReviewSummary(review: ExportReview): string {
  if (!review.checked) return review.why;
  if (review.ok) return 'The finished file matches the cut.';
  return review.problems.map((problem) => problem.detail).join(' ');
}
