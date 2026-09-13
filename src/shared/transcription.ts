import { parseSubtitleCues, type SubtitleCue } from './narrationPlan';
import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';
import type { TimelineDocument, TimelineTitle } from './timelineTypes';
import { applyCaptionPreset, copyTitleAppearance, DEFAULT_CAPTION_PRESET_ID, isAutomaticCaptionId } from './captionStyle';
import { timelineTimeMsAt } from './timelineClipGeometry';

export const TRANSCRIPTION_DRAFT_STATUSES = ['draft', 'approved'] as const;
export const TRANSCRIPTION_JOB_STATUSES = ['queued', 'normalizing', 'transcribing', 'completed', 'failed', 'cancelled'] as const;
export type TranscriptionDraftStatus = (typeof TRANSCRIPTION_DRAFT_STATUSES)[number];
export type TranscriptionJobStatus = (typeof TRANSCRIPTION_JOB_STATUSES)[number];

export type TranscriptionDraft = {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly engine: 'whisper.cpp';
  readonly modelName: string;
  readonly language: string;
  readonly createdAt: string;
  readonly status: TranscriptionDraftStatus;
  readonly cues: readonly SubtitleCue[];
};

export type StartTranscriptionInput = {
  readonly projectId: string;
  readonly assetId: string;
  readonly language: string;
};

export type TranscriptionJob = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceAssetId: string;
  readonly status: TranscriptionJobStatus;
  readonly progressPercent: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly draft?: TranscriptionDraft;
  readonly error?: string;
};

export type WhisperCppRuntimeStatus = {
  readonly ready: boolean;
  readonly reason?: string;
  readonly executableName?: string;
  readonly modelName?: string;
  readonly version?: string;
  readonly checksumVerified: boolean;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const LANGUAGE = /^(?:auto|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/;

function isoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export function parseStartTranscriptionInput(value: unknown): StartTranscriptionInput | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['projectId', 'assetId', 'language']) ||
    typeof value.projectId !== 'string' || !ID.test(value.projectId) ||
    typeof value.assetId !== 'string' || !ID.test(value.assetId) ||
    typeof value.language !== 'string' || !LANGUAGE.test(value.language.toLowerCase())) return null;
  return { projectId: value.projectId, assetId: value.assetId, language: value.language.toLowerCase() };
}

export function parseTranscriptionDraft(value: unknown): TranscriptionDraft | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'sourceAssetId', 'engine', 'modelName', 'language', 'createdAt', 'status', 'cues']) ||
    typeof value.id !== 'string' || !ID.test(value.id) ||
    typeof value.sourceAssetId !== 'string' || !ID.test(value.sourceAssetId) ||
    value.engine !== 'whisper.cpp' ||
    typeof value.modelName !== 'string' || !value.modelName.trim() || value.modelName.length > 200 ||
    typeof value.language !== 'string' || !LANGUAGE.test(value.language.toLowerCase()) ||
    !isoTimestamp(value.createdAt) ||
    typeof value.status !== 'string' || !(TRANSCRIPTION_DRAFT_STATUSES as readonly string[]).includes(value.status)) return null;
  const cues = parseSubtitleCues(value.cues);
  if (cues === null) return null;
  return {
    id: value.id,
    sourceAssetId: value.sourceAssetId,
    engine: 'whisper.cpp',
    modelName: value.modelName.trim(),
    language: value.language.toLowerCase(),
    createdAt: value.createdAt,
    status: value.status as TranscriptionDraftStatus,
    cues
  };
}

export function updateTranscriptionDraft(
  draft: TranscriptionDraft,
  cues: readonly SubtitleCue[],
  approve = false
): TranscriptionDraft {
  const parsed = parseTranscriptionDraft({ ...draft, cues, status: approve ? 'approved' : 'draft' });
  if (parsed === null) throw new Error('Transcript cues must be nonempty, ordered, and must not overlap.');
  return parsed;
}

export function applyTranscriptionCues(timeline: TimelineDocument, draft: TranscriptionDraft): TimelineDocument {
  if (draft.status !== 'approved') throw new Error('Approve the transcript before applying its captions.');
  const sourceClips = timeline.tracks.flatMap((track) => track.clips).filter((clip) => clip.assetId === draft.sourceAssetId);
  if (sourceClips.length === 0) throw new Error('Place the transcript source asset on the timeline before applying captions.');
  const priorAppearance = (timeline.titles ?? []).find((title) => isAutomaticCaptionId(title.id));
  const retained = (timeline.titles ?? []).filter((title) => !isAutomaticCaptionId(title.id));
  const captions: TimelineTitle[] = [];
  const hash = (value: string): string => {
    let output = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) { output ^= value.charCodeAt(index); output = Math.imul(output, 0x01000193); }
    return (output >>> 0).toString(16).padStart(8, '0');
  };
  for (const clip of sourceClips) for (const [index, cue] of draft.cues.entries()) {
    const sourceStartMs = Math.max(cue.startMs, clip.sourceStartMs);
    const sourceEndMs = Math.min(cue.endMs, clip.sourceEndMs);
    if (sourceEndMs <= sourceStartMs) continue;
    const caption = applyCaptionPreset({
      id: `transcript-caption-${hash(`${draft.id}:${clip.id}`)}-${index + 1}`,
      text: cue.text,
      timelineStartMs: Math.floor(timelineTimeMsAt(clip, sourceStartMs)),
      timelineEndMs: Math.ceil(timelineTimeMsAt(clip, sourceEndMs)),
      sizePx: 64,
      color: '#ffffff',
      positionX: 0,
      positionY: 0
    }, DEFAULT_CAPTION_PRESET_ID);
    captions.push(priorAppearance === undefined ? caption : copyTitleAppearance(caption, priorAppearance));
  }
  if (captions.length === 0) throw new Error('No transcript cues overlap the placed source clips.');
  captions.sort((left, right) => left.timelineStartMs - right.timelineStartMs || left.timelineEndMs - right.timelineEndMs || left.id.localeCompare(right.id));
  return { ...timeline, titles: [...retained, ...captions] };
}

export { isAutomaticCaptionId } from './captionStyle';
