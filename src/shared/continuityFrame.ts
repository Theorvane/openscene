import type { ReferenceImageSelection } from './providerSeams';
import type { MediaAsset } from './timelineTypes';
import { getOpaqueId, hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

/** Project-scoped media input. The main process resolves the actual path. */
export type ProjectAssetReferenceInput = {
  readonly projectId: string;
  readonly assetId: string;
};

export type ExtractContinuationFrameResult = {
  readonly asset: MediaAsset;
  readonly reference: ReferenceImageSelection;
  readonly sourceTimeMs: number;
};

export function parseProjectAssetReferenceInput(value: unknown): ProjectAssetReferenceInput | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['projectId', 'assetId'])) return null;
  const projectId = getOpaqueId(value, 'projectId');
  const assetId = getOpaqueId(value, 'assetId');
  return projectId === null || assetId === null ? null : { projectId, assetId };
}
