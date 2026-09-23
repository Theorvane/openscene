import type { AiProjectDocument } from './aiProjectDomain';
import { VIDEO_OPERATIONS, type VideoOperation } from './mediaCapabilityRegistry';
import { getOpaqueId, hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

/** Exact submitted text and non-secret settings; never temporary paths or image bytes. */
export type VideoRecipe = {
  readonly id: string;
  readonly assetId: string;
  readonly prompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly operation: VideoOperation;
  readonly durationSeconds: number;
  readonly aspectRatio: string;
  readonly createdAt: string;
  readonly parentId?: string;
};
export function parseVideoRecipeHistory(value: unknown): readonly VideoRecipe[] | null {
  if (!Array.isArray(value) || value.length > 10000) return null;
  const records: VideoRecipe[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || !hasAllowedKeys(item, ['id','assetId','prompt','modelId','providerId','operation','durationSeconds','aspectRatio','createdAt','parentId'])) return null;
    const id = getOpaqueId(item, 'id'); const assetId = getOpaqueId(item, 'assetId');
    if (id === null || assetId === null || ids.has(id)) return null;
    if (typeof item.prompt !== 'string' || (!item.prompt.trim() && item.operation !== 'motion_control') || item.prompt.length > 100000) return null;
    if (typeof item.modelId !== 'string' || !item.modelId || item.modelId.length > 200 ||
      typeof item.providerId !== 'string' || !item.providerId || item.providerId.length > 200) return null;
    if (typeof item.operation !== 'string' || !(VIDEO_OPERATIONS as readonly string[]).includes(item.operation)) return null;
    if (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0 || item.durationSeconds > 600) return null;
    if (typeof item.aspectRatio !== 'string' || !/^\d{1,3}:\d{1,3}$/.test(item.aspectRatio)) return null;
    if (typeof item.createdAt !== 'string' || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt))) return null;
    if (item.parentId !== undefined && (getOpaqueId(item, 'parentId') === null || item.parentId === id)) return null;
    ids.add(id);
    records.push({ id, assetId, prompt: item.prompt, modelId: item.modelId, providerId: item.providerId,
      operation: item.operation as VideoOperation, durationSeconds: item.durationSeconds, aspectRatio: item.aspectRatio, createdAt: item.createdAt,
      ...(item.parentId === undefined ? {} : { parentId: item.parentId as string }) });
  }
  return records;
}

/** Idempotent imports do not duplicate history or mutate existing timeline/candidates. */
export function recordVideoRecipe(document: AiProjectDocument, recipe: VideoRecipe): AiProjectDocument {
  const existing = document.videoHistory ?? [];
  if (existing.some(entry => entry.id === recipe.id)) return document;
  const videoHistory = [...existing, recipe];
  if (parseVideoRecipeHistory(videoHistory) === null) throw new Error('Video recipe could not be saved: invalid record or history limit reached.');
  return { ...document, videoHistory };
}
