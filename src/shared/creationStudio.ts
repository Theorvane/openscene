import type { CreationTool } from './workspaceModes';
import type { AiProjectDocument } from './aiProjectDomain';
import { productionEditorItems, productionReadiness, type ProductionEditorAsset } from './productionEditor';

/** Presentation-only grouping. Persisted tool ids and job routing stay unchanged. */
export const CREATION_STAGES = [
  { id: 'story', label: 'Story', tool: 'writer', description: 'Write the brief, script and shot plan.' },
  { id: 'scenes', label: 'Scenes', tool: 'video', description: 'Prepare reference frames, generate takes and review shots.' },
  { id: 'sound', label: 'Voice & captions', tool: 'voice', description: 'Create narration and timed captions for the story.' }
] as const;
export function creationStageForTool(tool: CreationTool) {
  return CREATION_STAGES[tool === 'writer' ? 0 : tool === 'voice' ? 2 : 1];
}
export const SCENE_TOOLS = [
  { id: 'video', label: 'Video takes' },
  { id: 'image', label: 'Reference frames' }
] as const;

/** Describe available evidence, never infer approval from visiting a stage. */
export function creationStudioStatus(document: AiProjectDocument | null | undefined, assets: readonly ProductionEditorAsset[]) {
  const readiness = productionReadiness(document ? productionEditorItems(document, assets) : []);
  return {
    story: readiness.total ? `${readiness.total} shots in approved plan` : 'No approved shot plan',
    scenes: readiness.total ? `${readiness.approved}/${readiness.total} takes approved · ${readiness.missing} missing · ${readiness.review} to review` : `${assets.filter(asset => asset.kind === 'video').length} saved videos`,
    sound: `${assets.filter(asset => asset.kind === 'audio').length} audio assets · ${document?.narrationPlan?.cues.length ?? 0} planned captions`
  };
}
