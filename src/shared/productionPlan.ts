import type { AiProjectDocument } from './aiProjectDomain';
import { applyWriterPipeline, approvedWriterShots, pipelineMatchesBrief, saveWriterArtifact, startWriterPipeline } from './writerPipeline';
import { batchableProductionVideoShotIds, planProductionVideoReferences, productionShotRegenerationBlockReason, productionSourceDurationSeconds } from './productionWorkflow';
import { DEFAULT_VIDEO_CONTINUITY_CONTROLS } from './videoContinuitySettings';
import { isVideoOperationImplemented } from './mediaCapabilityRegistry';
import { parseWriterPipelineState, WRITER_STAGES, type WriterPipelineState, type WriterStage } from './writerStages';
import { validateWriterResponse, writerDraftDurationSeconds, type WriterDraft, type WriterRequest } from './writerWorkflow';

/** One proposal, no implied approvals. The user reviews the whole package. */
export function proposeProductionPlan(request: WriterRequest, draft: WriterDraft, modelId: string): WriterPipelineState {
  const checked = validateWriterResponse(draft, request);
  if (!checked.ok) throw new Error(`${checked.issue.path}: ${checked.issue.message}`);
  if (request.shotDurationSeconds !== undefined && writerDraftDurationSeconds(checked.value) !== request.targetDurationSeconds) {
    throw new Error(`A ${request.targetDurationSeconds}s film needs exactly ${request.targetDurationSeconds / request.shotDurationSeconds} five-second shots.`);
  }
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

export function nextProductionCheckpoint(proposal: WriterPipelineState | undefined): WriterStage | null {
  if (!proposal || proposal.appliedScriptId) return null;
  return WRITER_STAGES.find(stage => !proposal.artifacts.some(artifact => artifact.stage === stage && artifact.approved)) ?? null;
}

/** Approve only the displayed checkpoint; final approval materializes the shots. */
export function approveProductionCheckpoint(document: AiProjectDocument, request: WriterRequest, proposal: WriterPipelineState, stage: WriterStage, createdAt: string, id: string): AiProjectDocument {
  if (!pipelineMatchesBrief(proposal, request)) throw new Error('The brief changed. Generate a revised plan before approval.');
  if (proposal.appliedScriptId) throw new Error('This plan is already applied.');
  if (nextProductionCheckpoint(proposal) !== stage) throw new Error('Approve the current checkpoint before advancing.');
  const artifact = proposal.artifacts.find(item => item.stage === stage);
  if (!artifact) throw new Error('The checkpoint is missing from this proposal.');
  const approved = saveWriterArtifact(proposal, artifact, true);
  if (stage !== 'prompts') return { ...document, writerPipeline: approved };
  const result = applyWriterPipeline(document, approved, createdAt, id);
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

/** A constrained text-only batch prices provider source lengths and preserves five-second finished cuts. */
export function productionTextBatch(document: AiProjectDocument, modelId: string) {
  const eligible = new Set(batchableProductionVideoShotIds(document));
  const shots = approvedWriterShots(document).filter(shot => eligible.has(shot.id));
  const sources = shots.map((shot) => productionSourceDurationSeconds(modelId, 'text_to_video', shot.durationSeconds));
  if (!shots.length) return { ok: false as const, reason: 'No new or failed shots to generate. Review existing takes.' };
  if (!isVideoOperationImplemented(modelId, 'text_to_video') || shots.some((shot, index) => sources[index] === null || shot.referenceAssetIds.length > 0 || planProductionVideoReferences(document, shot.id, {
    controls: DEFAULT_VIDEO_CONTINUITY_CONTROLS, supportsImageToVideo: false, supportsReferenceToVideo: false, supportsTextToVideo: true
  }).kind !== 'text')) {
    return { ok: false as const, reason: 'This batch needs a text-to-video model that can make source clips at least as long as every planned shot, with no required reference images. Use desktop for reference-driven batches; no charge was made.' };
  }
  return { ok: true as const, shots: shots.map((shot, index) => ({ ...shot, sourceDurationSeconds: sources[index]! })) };
}

/** Explicit one-shot text generation; unlike the batch, an approved shot can receive a new take. */
export function productionTextShot(document: AiProjectDocument, modelId: string, shotId: string) {
  const shot = approvedWriterShots(document).find((entry) => entry.id === shotId);
  if (shot === undefined) return { ok: false as const, reason: 'This shot is not in the active approved Writer plan.' };
  const block = productionShotRegenerationBlockReason(document, shotId);
  if (block !== null) return { ok: false as const, reason: block };
  const sourceDurationSeconds = productionSourceDurationSeconds(modelId, 'text_to_video', shot.durationSeconds);
  if (sourceDurationSeconds === null || shot.referenceAssetIds.length > 0 || planProductionVideoReferences(document, shotId, {
    controls: DEFAULT_VIDEO_CONTINUITY_CONTROLS, supportsImageToVideo: false, supportsReferenceToVideo: false, supportsTextToVideo: true
  }).kind !== 'text') {
    return { ok: false as const, reason: 'This shot needs a compatible text-to-video model and no required reference images. Use desktop for reference-driven generation.' };
  }
  return { ok: true as const, shot: { ...shot, sourceDurationSeconds } };
}
