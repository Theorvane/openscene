import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';
import { parseVoiceDeliverySettings, type VoiceDeliverySettings } from './voiceDelivery';

export const NARRATION_PLAN_STATUSES = ['draft', 'approved'] as const;
export type NarrationPlanStatus = (typeof NARRATION_PLAN_STATUSES)[number];
export type SubtitleCue = { readonly id: string; readonly text: string; readonly startMs: number; readonly endMs: number };
export type NarrationPlan = {
  readonly sourceFingerprint: string;
  readonly sourceScriptId?: string;
  readonly script: string;
  readonly voiceModelId: string;
  readonly voiceId: string;
  readonly delivery?: VoiceDeliverySettings;
  readonly status: NarrationPlanStatus;
  readonly cues: readonly SubtitleCue[];
};

function normalizeNarrationText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function narrationScriptFromCues(cues: readonly SubtitleCue[]): string {
  return cues.map((cue) => normalizeNarrationText(cue.text)).filter(Boolean).join(' ');
}

export function parseSubtitleCues(value: unknown): readonly SubtitleCue[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5_000) return null;
  const cues: SubtitleCue[] = [];
  const ids = new Set<string>();
  for (const cue of value) {
    if (!isPlainRecord(cue) || !hasAllowedKeys(cue, ['id', 'text', 'startMs', 'endMs']) ||
      typeof cue.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(cue.id) || ids.has(cue.id) ||
      typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 500 ||
      typeof cue.startMs !== 'number' || !Number.isSafeInteger(cue.startMs) || cue.startMs < 0 ||
      typeof cue.endMs !== 'number' || !Number.isSafeInteger(cue.endMs) || cue.endMs <= cue.startMs || cue.endMs > 7_200_000) return null;
    ids.add(cue.id); cues.push({ id: cue.id, text: cue.text.trim(), startMs: cue.startMs, endMs: cue.endMs });
  }
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
  return sorted.some((cue, index) => index > 0 && cue.startMs < sorted[index - 1]!.endMs) ? null : sorted;
}

export function parseNarrationPlan(value: unknown): NarrationPlan | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['sourceFingerprint', 'sourceScriptId', 'script', 'voiceModelId', 'voiceId', 'delivery', 'status', 'cues']) ||
    typeof value.sourceFingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(value.sourceFingerprint) ||
    (value.sourceScriptId !== undefined && (typeof value.sourceScriptId !== 'string' || value.sourceScriptId.length > 200)) ||
    typeof value.script !== 'string' || !value.script.trim() || value.script.length > 200_000 ||
    typeof value.voiceModelId !== 'string' || value.voiceModelId.length > 200 ||
    typeof value.voiceId !== 'string' || value.voiceId.length > 500 ||
    (value.delivery !== undefined && parseVoiceDeliverySettings(value.delivery) === null) ||
    typeof value.status !== 'string' || !(NARRATION_PLAN_STATUSES as readonly string[]).includes(value.status)) return null;
  const sorted = parseSubtitleCues(value.cues);
  if (sorted === null) return null;
  if (narrationScriptFromCues(sorted) !== normalizeNarrationText(value.script)) return null;
  return {
    sourceFingerprint: value.sourceFingerprint,
    ...(value.sourceScriptId === undefined ? {} : { sourceScriptId: value.sourceScriptId as string }),
    script: value.script.trim(), voiceModelId: value.voiceModelId, voiceId: value.voiceId,
    ...(value.delivery === undefined ? {} : { delivery: parseVoiceDeliverySettings(value.delivery)! }),
    status: value.status as NarrationPlanStatus, cues: sorted
  };
}
