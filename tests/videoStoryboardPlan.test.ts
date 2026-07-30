import { describe, expect, it } from 'vitest';

import {
  CONTINUITY_KEYS,
  MAX_PLANNED_SHOTS,
  planVideoStoryboard,
  supportedShotSeconds
} from '../src/shared/videoStoryboardPlan';

describe('shot length rules', () => {
  it('knows what each engine actually accepts', () => {
    expect(supportedShotSeconds('openai')).toEqual([4, 8, 12]);
    expect(supportedShotSeconds('google_gemini')).toEqual([4, 6, 8]);
    // An unknown engine gets the conservative pair rather than a guess.
    expect(supportedShotSeconds('kling')).toEqual([4, 8]);
  });
});

describe('storyboard planning', () => {
  it('fills the length with the longest legal shots first', () => {
    // Given / When
    const plan = planVideoStoryboard({ totalSeconds: 24, providerId: 'openai' });

    // Then
    // Fewer, longer clips: fewer provider calls and fewer seams to match than
    // six 4s shots would need.
    expect(plan.shots.map((shot) => shot.durationSeconds)).toEqual([12, 12]);
    expect(plan.totalSeconds).toBe(24);
    expect(plan.roundedFrom).toBeUndefined();
  });

  it('gives every shot a start time so the scenario has a timeline', () => {
    // Given / When
    const plan = planVideoStoryboard({ totalSeconds: 20, providerId: 'google_gemini' });

    // Then
    expect(plan.shots.map((shot) => shot.startSeconds)).toEqual([0, 8, 16]);
    expect(plan.shots.map((shot) => shot.index)).toEqual([1, 2, 3]);
  });

  it('reports when it could not hit the requested length exactly', () => {
    // Given / When
    // 10s cannot be made from 4/8/12, so the plan overshoots and says so
    // rather than quietly delivering a different video than was asked for.
    const plan = planVideoStoryboard({ totalSeconds: 10, providerId: 'openai' });

    // Then
    expect(plan.totalSeconds).not.toBe(10);
    expect(plan.roundedFrom).toBe(10);
    for (const shot of plan.shots) {
      expect(supportedShotSeconds('openai')).toContain(shot.durationSeconds);
    }
  });

  it('never emits a shot length the provider would reject', () => {
    // Given / When / Then
    // This is the failure the module exists to prevent: an illegal duration is
    // rejected by the provider only after the user approved the spend.
    for (const providerId of ['openai', 'google_gemini', 'byteplus', 'kling']) {
      const legal = supportedShotSeconds(providerId);
      for (const totalSeconds of [1, 3, 5, 7, 9, 13, 17, 30, 45, 60]) {
        for (const shot of planVideoStoryboard({ totalSeconds, providerId }).shots) {
          expect(legal, `${providerId} @ ${totalSeconds}s`).toContain(shot.durationSeconds);
        }
      }
    }
  });

  it('caps the shot count so a mistyped length cannot queue hundreds of paid jobs', () => {
    // Given / When
    const plan = planVideoStoryboard({ totalSeconds: 100_000, providerId: 'openai' });

    // Then
    expect(plan.shots.length).toBeLessThanOrEqual(MAX_PLANNED_SHOTS);
  });

  it('always produces at least one shot, even for a zero or negative request', () => {
    // Given / When / Then
    for (const totalSeconds of [0, -10]) {
      const plan = planVideoStoryboard({ totalSeconds, providerId: 'openai' });
      expect(plan.shots.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('carries the continuity checklist, because each shot is generated blind', () => {
    // Given / When
    const plan = planVideoStoryboard({ totalSeconds: 12, providerId: 'openai' });

    // Then
    // Separate provider calls share no memory, so anything that must stay the
    // same has to be restated in every shot prompt.
    expect(plan.continuityKeys).toEqual(CONTINUITY_KEYS);
    expect(plan.continuityKeys).toContain('wardrobe');
    expect(plan.continuityKeys).toContain('lighting');
  });
});
