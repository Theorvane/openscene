import type { AiProjectDocument } from './aiProjectDomain';
import {
  activeStyleReference,
  buildApprovedProductionAssemblyPlan,
  productionSceneRows,
  productionShotRows,
  type ProductionAssetSummary
} from './productionWorkflow';
import { WRITER_STAGES, type WriterStage } from './writerStages';

export type ProductionDashboardStage = {
  readonly id: WriterStage | 'scenes' | 'takes' | 'assembly';
  readonly label: string;
  readonly state: 'complete' | 'active' | 'waiting';
  readonly detail: string;
};

export type ProductionDashboardScene = {
  readonly sceneId: string;
  readonly number: number;
  readonly title: string;
  readonly objective: string;
  readonly startMs: number;
  readonly endMs: number;
};

export type ProductionDashboardActivity = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly at: string;
  readonly state: 'complete' | 'active' | 'failed';
};

export type ProductionDashboard = {
  readonly title: string;
  readonly screenplay: string;
  readonly screenplayApproved: boolean;
  readonly scenes: readonly ProductionDashboardScene[];
  readonly stages: readonly ProductionDashboardStage[];
  readonly decisions: readonly { readonly label: string; readonly value: string; readonly source: string }[];
  readonly activity: readonly ProductionDashboardActivity[];
  readonly status: string;
  readonly totalDurationMs: number;
  readonly assemblyReady: boolean;
};

const WRITER_STAGE_NAMES: Readonly<Record<WriterStage, string>> = {
  concept: 'Brief', screenplay: 'Script', breakdown: 'Scene plan', prompts: 'Shot prompts'
};

/** A truthful display model for the director dashboard on desktop and mobile. */
export function productionDashboard(document: AiProjectDocument, assets: readonly ProductionAssetSummary[]): ProductionDashboard {
  const script = document.scripts.find((entry) => entry.id === document.writerPipeline?.appliedScriptId);
  const sceneRows = productionSceneRows(document);
  const shotRows = productionShotRows(document);
  const assemblyReady = buildApprovedProductionAssemblyPlan(document, assets).ok;
  const firstUnapprovedWriterStage = WRITER_STAGES.find((stage) => !document.writerPipeline?.artifacts.some((artifact) => artifact.stage === stage && artifact.approved));
  const stages: ProductionDashboardStage[] = WRITER_STAGES.map((stage) => {
    const approved = document.writerPipeline?.artifacts.some((artifact) => artifact.stage === stage && artifact.approved) ?? false;
    return { id: stage, label: WRITER_STAGE_NAMES[stage], state: approved ? 'complete' : firstUnapprovedWriterStage === stage ? 'active' : 'waiting',
      detail: approved ? 'Approved' : firstUnapprovedWriterStage === stage ? 'Review in screenplay and plan controls' : 'Waiting' };
  });
  const scenesApproved = sceneRows.length > 0 && sceneRows.every((scene) => scene.approved);
  const takesApproved = shotRows.length > 0 && shotRows.every((shot) => shot.state === 'approved');
  stages.push({ id: 'scenes', label: 'Scene approval', state: scenesApproved ? 'complete' : script ? 'active' : 'waiting',
    detail: `${sceneRows.filter((scene) => scene.approved).length}/${sceneRows.length} scenes approved` });
  stages.push({ id: 'takes', label: 'Takes', state: takesApproved ? 'complete' : sceneRows.some((scene) => scene.approved) ? 'active' : 'waiting',
    detail: `${shotRows.filter((shot) => shot.state === 'approved').length}/${shotRows.length} shots approved` });
  stages.push({ id: 'assembly', label: 'Final cut', state: assemblyReady ? 'active' : 'waiting',
    detail: assemblyReady ? 'Ready to assemble' : 'Awaiting approved takes' });

  let startMs = 0;
  const scenes = sceneRows.map((scene) => {
    const row = { sceneId: scene.sceneId, number: scene.order + 1, title: scene.title,
      objective: scene.objective, startMs, endMs: startMs + scene.durationMs };
    startMs = row.endMs;
    return row;
  });
  const decisions: { label: string; value: string; source: string }[] = [];
  const bible = document.styleBible;
  if (bible.lighting.trim()) decisions.push({ label: 'Lighting', value: bible.lighting, source: 'Approved style bible' });
  if (bible.cameraGrammar.trim()) decisions.push({ label: 'Camera grammar', value: bible.cameraGrammar, source: 'Approved style bible' });
  const styleReference = activeStyleReference(document);
  if (styleReference) decisions.push({ label: 'Visual reference', value: styleReference.label, source: 'Assigned project image' });

  const shotById = new Map(shotRows.map((shot) => [shot.shotId, shot]));
  const activity: ProductionDashboardActivity[] = [
    ...document.generations.filter((entry) => shotById.has(entry.shotId)).map((entry) => ({
      id: entry.id, label: shotById.get(entry.shotId)!.label, at: entry.updatedAt,
      detail: entry.review?.decision === 'approved' ? 'Take approved' : entry.review?.decision === 'rejected' ? 'Take rejected' : entry.status === 'completed' ? 'Take ready for review' : entry.status === 'failed' ? 'Generation failed' : 'Generation ' + entry.status,
      state: entry.status === 'failed' || entry.status === 'cancelled' ? 'failed' as const : entry.review?.decision === 'approved' || entry.status === 'completed' ? 'complete' as const : 'active' as const
    })),
    ...document.scenes.filter((scene) => scene.productionApprovedAt && scene.scriptVersionId === script?.id).map((scene) => ({
      id: `scene-${scene.id}`, label: scene.title, at: scene.productionApprovedAt!, detail: 'Scene approved', state: 'complete' as const
    }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const currentScene = sceneRows.find((scene) => !scene.complete);
  const status = assemblyReady ? 'Ready for final cut'
    : shotRows.some((shot) => shot.state === 'generating') ? 'Generating shots'
    : shotRows.some((shot) => shot.state === 'needs_review' || shot.state === 'needs_import') ? 'Awaiting take review'
    : currentScene?.canApprove ? `Awaiting ${currentScene.title} approval`
    : 'In production';
  return { title: script?.title ?? 'Short-film production', screenplay: script?.screenplay ?? '', screenplayApproved: script?.status === 'approved' || (script !== undefined && document.writerPipeline?.appliedScriptId === script.id && WRITER_STAGES.every((stage) => document.writerPipeline?.artifacts.some((artifact) => artifact.stage === stage && artifact.approved))),
    scenes, stages, decisions, activity, status, totalDurationMs: startMs, assemblyReady };
}
