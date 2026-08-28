/**
 * The words actually sent to a video model, and how they change when someone
 * says what they wanted instead.
 *
 * Generating a sequence worked; everything after the first take did not. The
 * scenario prompt was reused verbatim for every shot with "shot 3 of 5" glued
 * on, built inline inside one screen — so a shot could not carry its own
 * description, a take that came back wrong could only be made again by paying
 * for the whole plan, and saying what to change meant retyping the prompt from
 * memory.
 *
 * Composing is a rule rather than a template in a screen because three callers
 * have to send the same thing: the phone, the desktop studio, and the agent. A
 * prompt that differs between them is a different shot.
 *
 * Refining is deliberately arithmetic and not a model. Asking a model to
 * rewrite a prompt loses the parts nobody mentioned — the wardrobe, the lens,
 * the location — which is exactly what continuity depends on. The previous
 * prompt is kept whole and the change is added to it, so intent accumulates
 * instead of being paraphrased away.
 */

import { CONTINUITY_KEYS } from './videoStoryboardPlan';

/**
 * OpenScene's own bound on what it will send, not a limit quoted from any
 * provider.
 *
 * Providers differ and their published limits move; what is certain is that a
 * prompt grown by a dozen revisions stops being read as a whole. Refusing at a
 * known point beats a provider silently truncating the end — where the newest
 * revision, the one the user just asked for, happens to live.
 */
export const MAX_SHOT_PROMPT_CHARS = 2_000;

export type ShotContinuity =
  /** No frame to hand over, so what must stay the same is restated in words. */
  | 'restate'
  /** The model is looking at the previous shot's last frame; it can see them. */
  | 'from-frame'
  /** A single shot that continues nothing. */
  | 'none';

export type ShotBrief = {
  /** The whole piece, in the user's words. Every shot carries it. */
  readonly scenario: string;
  /** 1-based, as people count shots. */
  readonly index: number;
  readonly count: number;
  readonly durationSeconds: number;
  /** What happens in this shot in particular. Absent means the scenario alone. */
  readonly description?: string;
  readonly continuity: ShotContinuity;
};

function continuityLine(continuity: ShotContinuity): string {
  switch (continuity) {
    case 'restate':
      return `Keep consistent: ${CONTINUITY_KEYS.join(', ')}.`;
    case 'from-frame':
      // With a start frame the model can see the continuity keys rather than
      // being told them, so it is asked to carry on instead of re-describing a
      // scene it is already looking at.
      return 'Continue directly from the supplied first frame, keeping the same subject, wardrobe, location and lighting.';
    case 'none':
      return '';
  }
}

/** The prompt for one shot, before any revision. */
export function composeShotPrompt(brief: ShotBrief): string {
  const scenario = brief.scenario.trim();
  const description = brief.description?.trim() ?? '';
  const place =
    brief.count > 1 ? `Shot ${brief.index} of ${brief.count}, ${brief.durationSeconds}s.` : `${brief.durationSeconds}s.`;
  const continuity = continuityLine(brief.continuity);

  // The shot's own description leads when there is one: it is the specific
  // thing being asked for, and the scenario is the context it sits in.
  return [description.length > 0 ? description : scenario, description.length > 0 ? `Scenario: ${scenario}` : '', place, continuity]
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
}

export type RefineResult =
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly reason: string };

const REVISION_HEADING = 'Revisions, applied in order to the shot above:';

/** The notes already on a prompt, so a caller can show them or count them. */
export function revisionsOf(prompt: string): readonly string[] {
  const headingAt = prompt.indexOf(REVISION_HEADING);
  if (headingAt < 0) return [];
  return prompt
    .slice(headingAt + REVISION_HEADING.length)
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/** The prompt without its revisions — what was asked for in the first place. */
export function originalOf(prompt: string): string {
  const headingAt = prompt.indexOf(REVISION_HEADING);
  return (headingAt < 0 ? prompt : prompt.slice(0, headingAt)).trim();
}

/**
 * A previous take's prompt plus what to change, as the prompt for the next
 * take.
 *
 * The previous prompt is kept whole. A note that repeats one already on the
 * prompt is not added twice — asking for the same change again is the same
 * request, and a doubled sentence reads as emphasis the user did not mean.
 */
export function refineShotPrompt(previousPrompt: string, note: string, maxChars = MAX_SHOT_PROMPT_CHARS): RefineResult {
  const change = note.trim();
  if (change.length === 0) {
    return { ok: false, reason: 'Say what to change about this shot.' };
  }

  const existing = revisionsOf(previousPrompt);
  if (existing.some((revision) => revision.toLowerCase() === change.toLowerCase())) {
    // Not an error: the prompt already asks for this, so the next take is the
    // one to run, unchanged.
    return { ok: true, prompt: previousPrompt };
  }

  const revisions = [...existing, change];
  const prompt = [
    originalOf(previousPrompt),
    '',
    REVISION_HEADING,
    ...revisions.map((revision, index) => `${index + 1}. ${revision}`)
  ].join('\n');

  if (prompt.length > maxChars) {
    return {
      ok: false,
      reason:
        `This shot's prompt would be ${prompt.length} characters, past the ${maxChars} this app will send. ` +
        'Fold the earlier changes into the description and start the shot again.'
    };
  }

  return { ok: true, prompt };
}

/** "Take 3" — what to call a regenerated shot in a list of its siblings. */
export function takeLabel(takeNumber: number): string {
  return `Take ${Math.max(1, Math.round(takeNumber))}`;
}
