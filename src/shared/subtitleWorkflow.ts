import type { AiProjectDocument } from './aiProjectDomain';
import type { NarrationPlan, SubtitleCue } from './narrationPlan';
import { parseNarrationPlan } from './narrationPlan';
import { createVoiceDeliverySettings } from './voiceDelivery';
import type { TimelineDocument, TimelineTitle } from './timelineTypes';
import { applyCaptionPreset, copyTitleAppearance, DEFAULT_CAPTION_PRESET_ID, isAutomaticCaptionId } from './captionStyle';
import { parseWriterPromptText } from './writerPipeline';
import { WRITER_STAGES } from './writerStages';

export const SUBTITLE_LIMITS = { maxCharsPerLine: 42, maxLines: 2, minCueMs: 650, maxCueMs: 6_000 } as const;

export function narrationFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function spokenText(value: string, speakers: readonly string[] = []): string {
  return value.split(/\r?\n/).map((line) => {
    const colon = line.search(/[:：]/u);
    const label = colon < 0 ? '' : line.slice(0, colon).trim();
    const known = speakers.some((speaker) => speaker.toLocaleLowerCase() === label.toLocaleLowerCase()) || /^(narrator|voice[ -]?over|vo)$/i.test(label);
    return (known ? line.slice(colon + 1) : line).trim();
  }).filter(Boolean).join(' ');
}
function chunks(text: string): readonly string[] {
  const units = text.trim().split(/(?<=[.!?…。！？])\s+|\r?\n+/u).filter(Boolean);
  const output: string[] = [];
  for (const unit of units) {
    const words = unit.trim().split(/\s+/); let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= SUBTITLE_LIMITS.maxCharsPerLine * SUBTITLE_LIMITS.maxLines) current = candidate;
      else { if (current) output.push(current); current = word; }
    }
    if (current) output.push(current);
  }
  return output;
}
function layOut(text: string): string {
  if (text.length <= SUBTITLE_LIMITS.maxCharsPerLine) return text;
  const midpoint = text.length / 2; let split = -1; let distance = Infinity;
  for (let index = 0; index < text.length; index += 1) if (text[index] === ' ' && Math.abs(index - midpoint) < distance) { split = index; distance = Math.abs(index - midpoint); }
  return split > 0 ? `${text.slice(0, split)}\n${text.slice(split + 1)}` : text;
}
function timedCues(text: string, startMs: number, endMs: number, prefix: string, speakers: readonly string[] = []): readonly SubtitleCue[] {
  const parts = chunks(spokenText(text, speakers));
  if (!parts.length || endMs - startMs < parts.length) return [];
  const weights = parts.map((part) => Math.max(1, [...part].length));
  let remainingWeight = weights.reduce((a, b) => a + b, 0); let cursor = startMs;
  return parts.map((part, index) => {
    const remaining = endMs - cursor;
    const remainingParts = parts.length - index;
    const minimum = Math.min(SUBTITLE_LIMITS.minCueMs, Math.max(1, Math.floor(remaining / remainingParts)));
    const maximum = Math.min(SUBTITLE_LIMITS.maxCueMs, remaining - (remainingParts - 1));
    const proportional = Math.round(remaining * weights[index]! / remainingWeight);
    const duration = Math.max(minimum, Math.min(maximum, proportional));
    const cueEnd = cursor + duration;
    const cue = { id: `${prefix}-${index + 1}`, text: layOut(part), startMs: cursor, endMs: cueEnd };
    cursor = cueEnd; remainingWeight -= weights[index]!; return cue;
  });
}

export function narrationFromApprovedWriter(ai: AiProjectDocument): { readonly scriptId: string; readonly script: string; readonly cues: readonly SubtitleCue[] } | null {
  const state = ai.writerPipeline;
  const promptArtifact = state?.artifacts.find((a) => a.stage === 'prompts' && a.approved);
  if (!state?.appliedScriptId || !promptArtifact || !WRITER_STAGES.every((stage) => state.artifacts.some((a) => a.stage === stage && a.approved)) || !ai.scripts.some((s) => s.id === state.appliedScriptId)) return null;
  const draft = parseWriterPromptText(promptArtifact.content);
  if (!draft) return null;
  let cursor = 0; const scripts: string[] = []; const cues: SubtitleCue[] = [];
  for (const [si, scene] of draft.scenes.entries()) for (const [sh, shot] of scene.shots.entries()) {
    const start = cursor; cursor += shot.durationSeconds * 1_000;
    const text = spokenText(shot.dialogue, scene.characterNames);
    if (text) { scripts.push(text); cues.push(...timedCues(text, start, cursor, `subtitle-${si + 1}-${sh + 1}`, scene.characterNames)); }
  }
  return scripts.length ? { scriptId: state.appliedScriptId, script: scripts.join('\n'), cues } : null;
}

export function createNarrationPlan(input: { readonly ai: AiProjectDocument; readonly script?: string; readonly durationMs: number; readonly voiceModelId: string; readonly voiceId: string }): NarrationPlan {
  const writer = input.script === undefined ? narrationFromApprovedWriter(input.ai) : null;
  const script = (input.script ?? writer?.script ?? '').trim();
  if (!script) throw new Error('Add narration text, or approve Writer prompts containing dialogue first.');
  const cues = writer?.script === script ? writer.cues : timedCues(script, 0, Math.max(1_000, Math.round(input.durationMs)), 'subtitle-manual');
  const plan = { sourceFingerprint: narrationFingerprint(script), ...(writer ? { sourceScriptId: writer.scriptId } : {}), script, voiceModelId: input.voiceModelId, voiceId: input.voiceId, delivery: createVoiceDeliverySettings(script), status: 'draft' as const, cues };
  const parsed = parseNarrationPlan(plan); if (!parsed) throw new Error('Narration could not be split into valid subtitle cues. Shorten the script or increase the duration.');
  return parsed;
}

export function updateNarrationPlan(plan: NarrationPlan, changes: Partial<Pick<NarrationPlan, 'script' | 'voiceModelId' | 'voiceId' | 'delivery' | 'cues'>>, approve = false): NarrationPlan {
  const script = (changes.script ?? plan.script).trim();
  const detached = changes.script !== undefined && script !== plan.script;
  const { sourceScriptId: _sourceScriptId, ...withoutSource } = plan;
  const candidate = { ...(detached ? withoutSource : plan), ...changes, script, sourceFingerprint: narrationFingerprint(script), status: approve ? 'approved' as const : 'draft' as const };
  const parsed = parseNarrationPlan(candidate); if (!parsed) throw new Error('Narration or subtitle timing is invalid. Cues must be nonempty, ordered, and must not overlap.');
  return parsed;
}

export function narrationPlanMatchesWriter(ai: AiProjectDocument, plan: NarrationPlan): boolean {
  if (!plan.sourceScriptId) return true;
  const source = narrationFromApprovedWriter(ai);
  return source !== null && source.scriptId === plan.sourceScriptId && narrationFingerprint(source.script) === plan.sourceFingerprint;
}

export function applySubtitleCues(timeline: TimelineDocument, plan: NarrationPlan): TimelineDocument {
  if (plan.status !== 'approved') throw new Error('Approve the narration and subtitles before applying them.');
  const prefix = `auto-caption-${plan.sourceFingerprint}-`;
  const priorAppearance = (timeline.titles ?? []).find((title) => isAutomaticCaptionId(title.id));
  const retained = (timeline.titles ?? []).filter((title) => !isAutomaticCaptionId(title.id));
  const captions: TimelineTitle[] = plan.cues.map((cue, index) => {
    const caption = applyCaptionPreset({ id: `${prefix}${index + 1}`, text: cue.text, timelineStartMs: cue.startMs, timelineEndMs: cue.endMs, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 0 }, DEFAULT_CAPTION_PRESET_ID);
    return priorAppearance === undefined ? caption : copyTitleAppearance(caption, priorAppearance);
  });
  return { ...timeline, titles: [...retained, ...captions] };
}
