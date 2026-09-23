import type { AiProjectDocument } from './aiProjectDomain';
import { applyWriterPipeline, approvedWriterShots, pipelineMatchesBrief, saveWriterArtifact, startWriterPipeline } from './writerPipeline';
import { batchableProductionVideoShotIds, planProductionVideoReferences } from './productionWorkflow';
import { DEFAULT_VIDEO_CONTINUITY_CONTROLS } from './videoContinuitySettings';
import { getVideoOperationConstraints, isVideoOperationImplemented } from './mediaCapabilityRegistry';
import { parseWriterPipelineState, WRITER_STAGES, type WriterPipelineState } from './writerStages';
import { validateWriterDraft, type WriterDraft, type WriterRequest } from './writerWorkflow';

/** One proposal, no implied approvals. The user reviews the whole package. */
export function proposeProductionPlan(request: WriterRequest, draft: WriterDraft, modelId: string): WriterPipelineState {
  const checked = validateWriterDraft(draft);
  if (!checked.ok) throw new Error(`${checked.issue.path}: ${checked.issue.message}`);
  const base = startWriterPipeline(request);
  const content = {
    concept: request.sourceText,
    screenplay: draft.screenplay,
    breakdown: draft.scenes.map((scene, i) => `${i + 1}. ${scene.title}\n${scene.setting} · ${scene.timeOfDay}\n${scene.continuityNotes}\n${scene.shots.map((shot, j) => `Shot ${j + 1}: ${shot.durationSeconds}s · ${shot.action}`).join('\n')}`).join('\n\n'),
    prompts: JSON.stringify(draft, null, 2)
  };
  const proposal = { ...base, artifacts: WRITER_STAGES.map(stage => ({ stage, title: draft.title, content: content[stage], modelId, approved: false })) };
  if (!parseWriterPipelineState(proposal)) throw new Error('The production plan exceeds supported document limits.');
  return proposal;
}

/** Only called by explicit approval of the displayed package, not by generation. */
export function approveProductionPlan(document: AiProjectDocument, request: WriterRequest, proposal: WriterPipelineState, createdAt: string, id: string) {
  if (!pipelineMatchesBrief(proposal, request)) throw new Error('The brief changed. Generate a revised plan before approval.');
  if (proposal.appliedScriptId) throw new Error('This plan is already applied.');
  let approved: WriterPipelineState = { ...proposal, artifacts: proposal.artifacts.map(item => ({ ...item, approved: false })) };
  for (const stage of WRITER_STAGES) {
    const artifact = approved.artifacts.find(item => item.stage === stage);
    if (!artifact) throw new Error('The production plan is incomplete.');
    approved = saveWriterArtifact(approved, artifact, true);
  }
  const result = applyWriterPipeline(document, approved, createdAt, id);
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

/** A constrained text-only batch never substitutes duration or drops references. */
export function productionTextBatch(document: AiProjectDocument, modelId: string) {
  const eligible = new Set(batchableProductionVideoShotIds(document));
  const shots = approvedWriterShots(document).filter(shot => eligible.has(shot.id));
  const durations = getVideoOperationConstraints(modelId, 'text_to_video')?.durationSeconds ?? [];
  if (!shots.length) return { ok: false as const, reason: 'No new or failed shots to generate. Review existing takes.' };
  if (!isVideoOperationImplemented(modelId, 'text_to_video') || shots.some(shot => !durations.includes(shot.durationSeconds) || shot.referenceAssetIds.length > 0 || planProductionVideoReferences(document, shot.id, {
    controls: DEFAULT_VIDEO_CONTINUITY_CONTROLS, supportsImageToVideo: false, supportsReferenceToVideo: false, supportsTextToVideo: true
  }).kind !== 'text')) {
    return { ok: false as const, reason: 'This batch needs a text-to-video model supporting every planned duration and no required reference images. Use the desktop production board for reference-driven batches; no fallback or charge was made.' };
  }
  return { ok: true as const, shots };
}
