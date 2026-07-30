import { describe, expect, it } from 'vitest';

import {
  checkNarrationFit,
  countNarrationUnits,
  detectScriptKind,
  estimateNarrationSeconds,
  narrationBudget
} from '../src/shared/narrationTiming';

describe('script kind detection', () => {
  it('counts Korean by character, not by space-separated word', () => {
    // Given
    const korean = '오늘은 새로운 영상 편집기를 소개합니다.';

    // When / Then
    // Korean has no word spacing in the latin sense and is syllable-timed;
    // counting "words" here under-counts the delivery badly.
    expect(detectScriptKind(korean)).toBe('cjk-characters');
    expect(countNarrationUnits(korean)).toBe(17);
  });

  it('counts English by word', () => {
    expect(detectScriptKind('A short line of narration.')).toBe('latin-words');
    expect(countNarrationUnits('A short line of narration.')).toBe(5);
  });

  it('ignores punctuation and whitespace, which are not spoken', () => {
    expect(countNarrationUnits('안녕하세요, 반갑습니다!')).toBe(10);
    expect(countNarrationUnits('   ')).toBe(0);
  });
});

describe('duration estimates', () => {
  it('turns a word count into seconds at the chosen pace', () => {
    // Given
    const script = Array.from({ length: 150 }, () => 'word').join(' ');

    // When / Then
    // 150 words at 150 wpm is a minute; a brisker read is shorter.
    expect(estimateNarrationSeconds({ script, pace: 'natural' }).estimatedSeconds).toBe(60);
    expect(estimateNarrationSeconds({ script, pace: 'brisk' }).estimatedSeconds).toBeLessThan(60);
    expect(estimateNarrationSeconds({ script, pace: 'measured' }).estimatedSeconds).toBeGreaterThan(60);
  });

  it('gives a writable budget for a slot', () => {
    // Given / When
    const budget = narrationBudget({ targetSeconds: 20, kind: 'latin-words' });

    // Then
    expect(budget.units).toBe(50);
    expect(narrationBudget({ targetSeconds: 20, kind: 'cjk-characters' }).units).toBe(116);
  });

  it('never returns a negative budget for a nonsense slot', () => {
    expect(narrationBudget({ targetSeconds: -5, kind: 'latin-words' }).units).toBe(0);
  });
});

describe('fit against a slot', () => {
  it('flags an over-running script before any speech is paid for', () => {
    // Given
    const script = Array.from({ length: 100 }, () => 'word').join(' ');

    // When
    const fit = checkNarrationFit({ script, targetSeconds: 10 });

    // Then
    // Over-running pushes narration past the picture, which is the failure that
    // forces a re-record after the job has already been billed.
    expect(fit.verdict).toBe('too-long');
    expect(fit.deltaSeconds).toBeGreaterThan(0);
    expect(fit.advice).toMatch(/Cut to roughly 25 words/);
  });

  it('flags leftover silence, but tolerates a little', () => {
    // Given / When / Then
    const short = checkNarrationFit({ script: 'One line.', targetSeconds: 30 });
    expect(short.verdict).toBe('too-short');

    // Two words under a 1s slot is within tolerance: an editor absorbs that.
    const close = checkNarrationFit({ script: 'Two words here now five', targetSeconds: 2.5 });
    expect(close.verdict).toBe('fits');
  });

  it('always says the number is an estimate', () => {
    const fit = checkNarrationFit({ script: 'Five words in this line', targetSeconds: 2 });
    expect(fit.verdict).toBe('fits');
    expect(fit.advice).toMatch(/treat this as an estimate/);
  });

  it('reports the CJK case in characters rather than words', () => {
    // Given
    const long = '가'.repeat(400);

    // When
    const fit = checkNarrationFit({ script: long, targetSeconds: 10 });

    // Then
    expect(fit.verdict).toBe('too-long');
    expect(fit.advice).toMatch(/characters/);
  });
});
