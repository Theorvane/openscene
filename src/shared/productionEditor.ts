import type { AiProjectDocument } from './aiProjectDomain';
import { approvedWriterShots } from './writerPipeline';

export type ProductionEditorAsset = { readonly id: string; readonly kind: string; readonly displayName: string };
export type ProductionEditorItem = {
  readonly id: string; readonly lane: 'video' | 'voice' | 'subtitles'; readonly label: string;
  readonly prompt: string; readonly startMs?: number; readonly durationMs?: number;
  readonly assetId?: string; readonly shotId?: string; readonly recipeId?: string; readonly status: string;
};
export const PRODUCTION_LANES = ['video', 'voice', 'subtitles'] as const;
/** A read-only plan navigator, never a claim that unplaced assets are synchronized. */
export function productionEditorItems(document: AiProjectDocument, assets: readonly ProductionEditorAsset[]): readonly ProductionEditorItem[] {
  const items: ProductionEditorItem[] = [];
  const available = new Map(assets.map(asset => [asset.id, asset]));
  const used = new Set<string>();
  let startMs = 0;
  for (const shot of approvedWriterShots(document)) {
    const candidates = document.generations.filter(item => item.shotId === shot.id && item.status === 'completed');
    const candidate = candidates.filter(item => item.review?.decision === 'approved').at(-1) ?? candidates.filter(item => item.review?.decision !== 'rejected').at(-1);
    const assetId = candidate?.outputAssetIds.find(id => available.get(id)?.kind === 'video');
    if (assetId) used.add(assetId);
    items.push({ id: 'shot:' + shot.id, lane: 'video', label: shot.label, prompt: shot.prompt, shotId: shot.id,
      startMs, durationMs: shot.durationSeconds * 1000, ...(assetId ? { assetId } : {}),
      status: assetId ? candidate?.review?.decision === 'approved' ? 'Approved take' : 'Needs review' : 'Awaiting video' });
    startMs += shot.durationSeconds * 1000;
  }
  for (const recipe of document.videoHistory ?? []) {
    if (used.has(recipe.assetId)) continue;
    used.add(recipe.assetId);
    items.push({ id: 'recipe:' + recipe.id, lane: 'video', label: available.get(recipe.assetId)?.displayName ?? 'Saved prompt', prompt: recipe.prompt,
      recipeId: recipe.id, durationMs: recipe.durationSeconds * 1000,
      ...(available.get(recipe.assetId)?.kind === 'video' ? { assetId: recipe.assetId } : {}),
      status: available.has(recipe.assetId) ? 'Unplaced take' : 'Media unavailable' });
  }
  for (const asset of assets) {
    if (used.has(asset.id) || (asset.kind !== 'video' && asset.kind !== 'audio')) continue;
    items.push({ id: 'asset:' + asset.id, lane: asset.kind === 'audio' ? 'voice' : 'video', label: asset.displayName,
      assetId: asset.id, prompt: '', status: 'Unplaced media' });
  }
  for (const cue of document.narrationPlan?.cues ?? []) {
    items.push({ id: 'cue:' + cue.id, lane: 'subtitles', label: cue.text, prompt: cue.text,
      startMs: cue.startMs, durationMs: cue.endMs - cue.startMs, status: 'Planned caption' });
  }
  return items;
}
