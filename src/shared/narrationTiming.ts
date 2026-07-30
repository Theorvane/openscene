/**
 * Sizing a narration script to a cut.
 *
 * This is the same class of arithmetic as shot planning: a model asked to write
 * "about 20 seconds of narration" will happily produce 60 seconds of it, and the
 * mismatch only shows up after the speech job has been paid for and placed on
 * the timeline. So the length check happens in code, before generation.
 *
 * Rates are deliberately coarse. Real duration depends on the voice, the
 * punctuation, and how much the model pauses, so every result here is an
 * estimate and says so.
 */

/**
 * Latin scripts are counted in words; CJK has no spaces and a syllable-timed
 * delivery, so it is counted in characters. Treating Korean text as
 * space-separated words under-counts it badly.
 */
export type NarrationScriptKind = 'latin-words' | 'cjk-characters';

export type NarrationPace = 'measured' | 'natural' | 'brisk';

/** Words per minute for latin scripts, characters per minute for CJK. */
const RATES: Readonly<Record<NarrationScriptKind, Readonly<Record<NarrationPace, number>>>> = {
  // Typical voiceover ranges: documentary/explainer sits near 150 wpm.
  'latin-words': { measured: 125, natural: 150, brisk: 175 },
  // Korean and Japanese narration runs roughly 330-400 characters/minute.
  'cjk-characters': { measured: 300, natural: 350, brisk: 400 }
};

const CJK_PATTERN = /[　-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

/** Picks the counting model from the text rather than asking the caller. */
export function detectScriptKind(script: string): NarrationScriptKind {
  return CJK_PATTERN.test(script) ? 'cjk-characters' : 'latin-words';
}

export function countNarrationUnits(script: string, kind?: NarrationScriptKind): number {
  const resolved = kind ?? detectScriptKind(script);
  if (resolved === 'cjk-characters') {
    // Whitespace and punctuation are not spoken, so they are not counted.
    return script.replace(/[\s\p{P}]/gu, '').length;
  }
  return script.trim().length === 0 ? 0 : script.trim().split(/\s+/).length;
}

export type NarrationEstimate = {
  readonly kind: NarrationScriptKind;
  readonly units: number;
  readonly pace: NarrationPace;
  readonly estimatedSeconds: number;
};

export function estimateNarrationSeconds(input: {
  readonly script: string;
  readonly pace?: NarrationPace;
  readonly kind?: NarrationScriptKind;
}): NarrationEstimate {
  const kind = input.kind ?? detectScriptKind(input.script);
  const pace = input.pace ?? 'natural';
  const units = countNarrationUnits(input.script, kind);
  const perMinute = RATES[kind][pace];
  return {
    kind,
    units,
    pace,
    estimatedSeconds: Math.round((units / perMinute) * 60 * 10) / 10
  };
}

/** How many words or characters fit in a slot, so a script can be written to size. */
export function narrationBudget(input: {
  readonly targetSeconds: number;
  readonly kind: NarrationScriptKind;
  readonly pace?: NarrationPace;
}): { readonly kind: NarrationScriptKind; readonly pace: NarrationPace; readonly units: number } {
  const pace = input.pace ?? 'natural';
  const seconds = Math.max(0, input.targetSeconds);
  return {
    kind: input.kind,
    pace,
    units: Math.floor((seconds / 60) * RATES[input.kind][pace])
  };
}

export type NarrationFit = {
  readonly estimate: NarrationEstimate;
  readonly targetSeconds: number;
  readonly deltaSeconds: number;
  readonly verdict: 'fits' | 'too-long' | 'too-short';
  readonly advice: string;
};

/**
 * Tolerance before a script counts as mis-sized. Under-running leaves silence
 * the editor can absorb; over-running pushes narration past the picture, which
 * is the failure that forces a re-record.
 */
const OVER_TOLERANCE_SECONDS = 0.5;
const UNDER_TOLERANCE_SECONDS = 2;

export function checkNarrationFit(input: {
  readonly script: string;
  readonly targetSeconds: number;
  readonly pace?: NarrationPace;
}): NarrationFit {
  const estimate = estimateNarrationSeconds(input);
  const deltaSeconds = Math.round((estimate.estimatedSeconds - input.targetSeconds) * 10) / 10;
  const unitWord = estimate.kind === 'cjk-characters' ? 'characters' : 'words';

  if (deltaSeconds > OVER_TOLERANCE_SECONDS) {
    const budget = narrationBudget({
      targetSeconds: input.targetSeconds,
      kind: estimate.kind,
      ...(input.pace === undefined ? {} : { pace: input.pace })
    });
    return {
      estimate,
      targetSeconds: input.targetSeconds,
      deltaSeconds,
      verdict: 'too-long',
      advice: `About ${deltaSeconds}s too long. Cut to roughly ${budget.units} ${unitWord}, or raise the pace, before generating speech.`
    };
  }

  if (deltaSeconds < -UNDER_TOLERANCE_SECONDS) {
    return {
      estimate,
      targetSeconds: input.targetSeconds,
      deltaSeconds,
      verdict: 'too-short',
      advice: `About ${Math.abs(deltaSeconds)}s of silence left over. Add a line, or shorten the picture.`
    };
  }

  return {
    estimate,
    targetSeconds: input.targetSeconds,
    deltaSeconds,
    verdict: 'fits',
    advice: `Estimated ${estimate.estimatedSeconds}s against a ${input.targetSeconds}s slot. Delivery varies by voice, so treat this as an estimate.`
  };
}
