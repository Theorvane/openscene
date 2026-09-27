import type { MediaAsset } from './timelineTypes';

export function mergeImportedAssets(currentAssets: readonly MediaAsset[], importedAssets: readonly MediaAsset[]): readonly MediaAsset[] {
  if (importedAssets.length === 0) return currentAssets;
  const importedById = new Map(importedAssets.map((asset) => [asset.id, asset]));
  const seen = new Set<string>();
  const merged: MediaAsset[] = [];
  for (const asset of [...currentAssets, ...importedAssets]) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(importedById.get(asset.id) ?? asset);
  }
  return merged;
}
