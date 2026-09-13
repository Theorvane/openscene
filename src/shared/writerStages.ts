import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export const WRITER_STAGES = ['concept', 'screenplay', 'breakdown', 'prompts'] as const;
export type WriterStage = (typeof WRITER_STAGES)[number];
export const WRITER_STAGE_LABELS: Record<WriterStage, string> = {
  concept: '1. Develop idea', screenplay: '2. Screenplay',
  breakdown: '3. Segments & scenes', prompts: '4. Video prompts'
};
export const WRITER_STAGE_CHECKLISTS: Record<WriterStage, readonly string[]> = {
  concept: ['A distinctive angle, not just a topic', 'A specific audience promise and opening hook', 'Characters, conflict, escalation and an earned ending', 'Assumptions and factual claims clearly identified'],
  screenplay: ['Complete playable action and spoken lines, not a synopsis', 'Setup/payoff and meaningful progression', 'Natural dialogue; visual comedy or emotion appropriate to the brief', 'Pacing and narration fit the target runtime'],
  breakdown: ['Every screenplay beat assigned to a numbered segment/scene', 'Time budget totals the requested runtime', 'Canonical characters, locations, props and continuity', 'A clear purpose, action, sound and transition for each scene'],
  prompts: ['One filmable action per shot; no contradictory camera moves', 'Identity, wardrobe, setting and continuity are explicit', 'Dialogue, sound and negative constraints reviewed', 'Exact total duration; provider clip limits checked before rendering']
};

export type WriterStageArtifact = {
  readonly stage: WriterStage;
  readonly title: string;
  /** Markdown for writing stages; a WriterDraft JSON object for the prompt stage. */
  readonly content: string;
  readonly approved: boolean;
  readonly modelId: string;
};
export type WriterPipelineState = {
  readonly appliedScriptId?: string;
  /** A serialized, credential-free base WriterRequest. Never a provider config. */
  readonly requestJson: string;
  readonly artifacts: readonly WriterStageArtifact[];
};

export function isWriterStage(value: unknown): value is WriterStage {
  return typeof value === 'string' && (WRITER_STAGES as readonly string[]).includes(value);
}

export function parseWriterPipelineState(value: unknown): WriterPipelineState | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['requestJson', 'artifacts', 'appliedScriptId']) ||
    typeof value.requestJson !== 'string' || value.requestJson.length > 500_000 ||
    !Array.isArray(value.artifacts) || value.artifacts.length > 4 ||
    (value.appliedScriptId !== undefined && (typeof value.appliedScriptId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value.appliedScriptId)))) return null;
  const artifacts: WriterStageArtifact[] = [];
  for (const item of value.artifacts) {
    if (!isPlainRecord(item) || !hasAllowedKeys(item, ['stage', 'title', 'content', 'approved', 'modelId']) ||
      !isWriterStage(item.stage) || artifacts.some((a) => a.stage === item.stage) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 ||
      typeof item.content !== 'string' || !item.content.trim() || item.content.length > (item.stage === 'prompts' ? 2_000_000 : 200_000) ||
      typeof item.approved !== 'boolean' || typeof item.modelId !== 'string' || item.modelId.length > 200) return null;
    artifacts.push({ stage: item.stage, title: item.title, content: item.content, approved: item.approved, modelId: item.modelId });
  }
  // An approved artifact can never sit behind a missing or unapproved predecessor.
  if (artifacts.some((a) => a.approved && !canOpenWriterStage({ artifacts }, a.stage))) return null;
  if (value.appliedScriptId !== undefined && !WRITER_STAGES.every((s) => artifacts.some((a) => a.stage === s && a.approved))) return null;
  return { requestJson: value.requestJson, artifacts, ...(value.appliedScriptId === undefined ? {} : { appliedScriptId: value.appliedScriptId as string }) };
}

export function canOpenWriterStage(state: Pick<WriterPipelineState, 'artifacts'>, stage: WriterStage): boolean {
  return WRITER_STAGES.slice(0, WRITER_STAGES.indexOf(stage))
    .every((previous) => state.artifacts.some((a) => a.stage === previous && a.approved));
}

/** Retain downstream work for inspection, but revoke every dependent approval. */
export function putWriterArtifact(state: WriterPipelineState, artifact: WriterStageArtifact): WriterPipelineState {
  if (!canOpenWriterStage(state, artifact.stage)) throw new Error('Approve every preceding stage first.');
  const index = WRITER_STAGES.indexOf(artifact.stage);
  const existing = state.artifacts.find((a) => a.stage === artifact.stage);
  const unchanged = existing?.content === artifact.content && existing.title === artifact.title;
  return {
    requestJson: state.requestJson,
    artifacts: [...state.artifacts.filter((a) => a.stage !== artifact.stage).map((a) =>
      !unchanged && WRITER_STAGES.indexOf(a.stage) > index ? { ...a, approved: false } : a), artifact]
      .sort((a, b) => WRITER_STAGES.indexOf(a.stage) - WRITER_STAGES.indexOf(b.stage))
  };
}
