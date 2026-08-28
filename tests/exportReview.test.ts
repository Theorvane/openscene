import { describe, expect, it } from 'vitest';

import { exportReviewSummary, reviewExport, type ExportPromise } from '../src/shared/exportReview';

const promise: ExportPromise = {
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 30,
  durationMs: 6_600,
  hasSound: true
};

describe('reviewing the finished file against the cut it came from', () => {
  it('passes a file that matches, and tolerates the rounding a container does', () => {
    const review = reviewExport(promise, {
      widthPx: 1920,
      heightPx: 1080,
      // 29.97 is what an encoder writes when it is asked for 30.
      frameRate: 29.97,
      durationMs: 6_712,
      hasSoundTrack: true
    });
    expect(review).toEqual({ checked: true, ok: true, problems: [] });
    expect(exportReviewSummary(review)).toBe('The finished file matches the cut.');
  });

  it('catches the truncated export that exited zero and wrote a file', () => {
    // The defect as it happened: a title overlay with no text ended the export
    // a third of the way in, and everything downstream called it a success.
    const review = reviewExport(promise, {
      widthPx: 1920,
      heightPx: 1080,
      frameRate: 30,
      durationMs: 2_470,
      hasSoundTrack: true
    });
    expect(review).toMatchObject({ checked: true, ok: false });
    expect(exportReviewSummary(review)).toContain('shorter');
    expect(exportReviewSummary(review)).toContain('2.47s');
  });

  it('catches a portrait cut written in landscape, and a silent one that should not be', () => {
    const review = reviewExport(promise, {
      widthPx: 1080,
      heightPx: 1920,
      frameRate: 30,
      durationMs: 6_600,
      hasSoundTrack: false
    });
    expect(review).toMatchObject({ checked: true, ok: false });
    const kinds = review.checked ? review.problems.map((problem) => problem.kind) : [];
    expect(kinds).toEqual(['frame', 'sound']);
  });

  it('does not complain about a silent file when there was nothing to hear', () => {
    const review = reviewExport(
      { ...promise, hasSound: false },
      { widthPx: 1920, heightPx: 1080, frameRate: 30, durationMs: 6_600, hasSoundTrack: false }
    );
    expect(review).toMatchObject({ ok: true });
  });

  it('says nothing about a frame rate the container did not report', () => {
    const review = reviewExport(promise, {
      widthPx: 1920,
      heightPx: 1080,
      durationMs: 6_600,
      hasSoundTrack: true
    });
    expect(review).toMatchObject({ ok: true });
  });

  it('reports an empty file as empty rather than as four separate faults', () => {
    const review = reviewExport(promise, { widthPx: 0, heightPx: 0, durationMs: 0, hasSoundTrack: false });
    expect(review).toMatchObject({ checked: true, ok: false, problems: [{ kind: 'empty' }] });
  });

  it('says it could not check rather than passing when nothing was measured', () => {
    const review = reviewExport(promise, null);
    expect(review.checked).toBe(false);
    expect(exportReviewSummary(review)).toContain('could not be measured');
  });
});
