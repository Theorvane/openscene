import type { MediaKind } from './timelineTypes';

export type EditAgentContextAsset = {
  readonly projectId: string;
  readonly assetId: string;
  readonly label: string;
  readonly mediaKind: MediaKind;
  readonly durationMs?: number;
};

/**
 * Project-scoped Edit Agent context: the safe, path-free summary of the
 * active project that every agent conversation operates on by default.
 */
export type EditAgentProjectContext = {
  readonly projectId: string;
  readonly name: string;
  readonly assetCount: number;
  readonly trackCount: number;
};

export function parseEditAgentProjectContext(value: unknown): EditAgentProjectContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<EditAgentProjectContext>;
  if (typeof candidate.projectId !== 'string' || candidate.projectId.trim().length === 0) return null;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) return null;
  if (typeof candidate.assetCount !== 'number' || !Number.isFinite(candidate.assetCount)) return null;
  if (typeof candidate.trackCount !== 'number' || !Number.isFinite(candidate.trackCount)) return null;

  return {
    projectId: candidate.projectId,
    name: candidate.name,
    assetCount: candidate.assetCount,
    trackCount: candidate.trackCount
  };
}

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
