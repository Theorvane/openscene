import type { AiProjectDocument } from './aiProjectDomain';
import { approvedWriterShots } from './writerPipeline';
import type { TimelineDocument } from './timelineTypes';
import { clipDurationMs } from './timelineClipGeometry';

export type ProductionEditorAsset = { readonly id: string; readonly kind: string; readonly displayName: string };
export type ProductionEditorItem = {
  readonly id: string; readonly lane: 'video' | 'voice' | 'subtitles'; readonly label: string;
  readonly prompt: string; readonly startMs?: number; readonly durationMs?: number;
  readonly assetId?: string; readonly shotId?: string; readonly recipeId?: string; readonly status: string;
  readonly sourceStartMs?: number;
};
export const PRODUCTION_LANES = ['video', 'voice', 'subtitles'] as const;
export function isTimedProductionItem(item: ProductionEditorItem): boolean {
  return item.startMs !== undefined && Number.isFinite(item.startMs) && item.startMs >= 0 &&
    item.durationMs !== undefined && Number.isFinite(item.durationMs) && item.durationMs > 0;
}
export function productionPlanDuration(items: readonly ProductionEditorItem[]): number {
  return items.reduce((end, item) => isTimedProductionItem(item) ? Math.max(end, item.startMs! + item.durationMs!) : end, 0);
}
/** Half-open intervals avoid selecting both neighboring shots at a cut. */
export function inspectProductionTime(items: readonly ProductionEditorItem[], requestedMs: number) {
  const durationMs = productionPlanDuration(items);
  const timeMs = Math.max(0, Math.min(durationMs, Number.isFinite(requestedMs) ? requestedMs : 0));
  const matches = items.filter(item => isTimedProductionItem(item) && item.startMs! <= timeMs && timeMs < item.startMs! + item.durationMs!);
  const video = matches.find(item => item.lane === 'video');
  return { timeMs, durationMs, video, sourceOffsetMs: video ? timeMs - video.startMs! : 0,
    captions: matches.filter(item => item.lane === 'subtitles') };
}
export function productionReadiness(items: readonly ProductionEditorItem[]) {
  const shots = items.filter(item => item.shotId !== undefined);
  return { total: shots.length, missing: shots.filter(item => !item.assetId).length,
    review: shots.filter(item => item.assetId && item.status !== 'Approved take').length,
    approved: shots.filter(item => item.assetId && item.status === 'Approved take').length };
}
/** A read-only plan navigator, never a claim that unplaced assets are synchronized. */
export function productionEditorItems(document: AiProjectDocument, assets: readonly ProductionEditorAsset[], timeline?: TimelineDocument | null): readonly ProductionEditorItem[] {
  const items: ProductionEditorItem[] = [];
  const available = new Map(assets.map(asset => [asset.id, asset]));
  const used = new Set<string>();
  for (const track of timeline?.tracks ?? []) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      const asset = available.get(clip.assetId);
      if (asset?.kind !== 'audio') continue;
      used.add(asset.id);
      items.push({ id: 'clip:' + clip.id, lane: 'voice', label: asset.displayName, prompt: '', assetId: asset.id,
        startMs: clip.timelineStartMs, durationMs: clipDurationMs(clip),
        sourceStartMs: clip.sourceStartMs, status: 'Placed audio' });
    }
  }
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
