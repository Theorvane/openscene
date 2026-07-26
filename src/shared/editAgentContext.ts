import type { MediaKind } from './timelineTypes';

export type EditAgentContextAsset = {
  readonly projectId: string;
  readonly assetId: string;
  readonly label: string;
  readonly mediaKind: MediaKind;
  readonly durationMs?: number;
};

export function addEditAgentContextAsset(
  current: readonly EditAgentContextAsset[],
  asset: EditAgentContextAsset
): readonly EditAgentContextAsset[] {
  if (asset.projectId.trim().length === 0) throw new Error('projectId is required for Edit Agent context.');
  if (asset.assetId.trim().length === 0) throw new Error('assetId is required for Edit Agent context.');
  if (asset.label.trim().length === 0) throw new Error('label is required for Edit Agent context.');

  return current.some((entry) => entry.projectId === asset.projectId && entry.assetId === asset.assetId)
    ? current
    : [...current, asset];
}

export function removeEditAgentContextAsset(
  current: readonly EditAgentContextAsset[],
  projectId: string,
  assetId: string
): readonly EditAgentContextAsset[] {
  return current.filter((entry) => entry.projectId !== projectId || entry.assetId !== assetId);
}
