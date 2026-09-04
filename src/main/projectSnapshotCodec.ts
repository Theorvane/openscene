import { PROJECT_SCHEMA_VERSION } from '../shared/timelineTypes';
import type { BrowserAssetMetadata, LocalProjectSnapshot, MediaAsset, MediaKind, TimelineDocument } from '../shared/timelineTypes';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from '../shared/aiProjectDomain';
import { migrateTimelineDocumentV1, migrateTimelineDocumentV2, parseTimelineDocument } from '../shared/timelineValidators';
import {
  TIMELINE_VALIDATION_LIMITS,
  getFiniteNonNegative,
  getMediaKind,
  getMimeType,
  getOpaqueId,
  getRelativePath,
  getTrimmedString,
  hasAllowedKeys,
  isPlainRecord,
  isUnknownArray
} from '../shared/timelineValidationPrimitives';
import { hasDeterministicAssetPath } from './assetLibrarySupport';

function getIsoTimestamp(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== value ? null : value;
}

function parseMetadata(value: unknown): BrowserAssetMetadata | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['durationMs', 'width', 'height'])) {
    return null;
  }
  const durationMs = getFiniteNonNegative(value, 'durationMs');
  const width = value.width === undefined ? undefined : getFiniteNonNegative(value, 'width');
  const height = value.height === undefined ? undefined : getFiniteNonNegative(value, 'height');
  if (durationMs === null || width === null || height === null) {
    return null;
  }
  return { durationMs, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) };
}

function parseAsset(value: unknown): MediaAsset | null {
  if (
    !isPlainRecord(value) ||
    !hasAllowedKeys(value, [
      'id',
      'displayName',
      'projectRelativePath',
      'kind',
      'mimeType',
      'byteLength',
      'metadata',
      'createdAt',
      'updatedAt'
    ])
  ) {
    return null;
  }
  const id = getOpaqueId(value, 'id');
  const displayName = getTrimmedString(value, 'displayName', TIMELINE_VALIDATION_LIMITS.nameLength);
  const projectRelativePath = getRelativePath(value, 'projectRelativePath');
  const kind = getMediaKind(value, 'kind');
  const mimeType = getMimeType(value, 'mimeType');
  const byteLength = getFiniteNonNegative(value, 'byteLength');
  const metadata = value.metadata === null ? null : parseMetadata(value.metadata);
  const createdAt = getIsoTimestamp(value, 'createdAt');
  const updatedAt = getIsoTimestamp(value, 'updatedAt');
  if (
    id === null ||
    displayName === null ||
    projectRelativePath === null ||
    kind === null ||
    mimeType === null ||
    byteLength === null ||
    !Number.isSafeInteger(byteLength) ||
    (metadata === null && value.metadata !== null) ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  const asset = { id, displayName, projectRelativePath, kind, mimeType, byteLength, metadata, createdAt, updatedAt };
  return hasDeterministicAssetPath(asset) ? asset : null;
}

export type InvalidAssetRelation = {
  readonly clipId: string;
  readonly trackKind: MediaKind;
  readonly reason: 'unavailable' | 'metadata_missing' | 'duration_mismatch' | 'bounds_exceeded';
};

export function findInvalidAssetRelation(
  timeline: TimelineDocument,
  assets: readonly MediaAsset[]
): InvalidAssetRelation | null {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const asset = assetsById.get(clip.assetId);
      if (asset === undefined || asset.kind !== track.kind) {
        return { clipId: clip.id, trackKind: track.kind, reason: 'unavailable' };
      }
      if (asset.metadata === null) {
        return { clipId: clip.id, trackKind: track.kind, reason: 'metadata_missing' };
      }
      if (clip.sourceStartMs > asset.metadata.durationMs || clip.sourceEndMs > asset.metadata.durationMs) {
        return { clipId: clip.id, trackKind: track.kind, reason: 'bounds_exceeded' };
      }
      if (clip.sourceDurationMs !== asset.metadata.durationMs) {
        return { clipId: clip.id, trackKind: track.kind, reason: 'duration_mismatch' };
      }
    }
  }
  return null;
}

function parseProjectRecord(
  value: Record<string, unknown>,
  timeline: TimelineDocument,
  aiValue: unknown,
  expectedProjectId?: string
): LocalProjectSnapshot | null {
  const id = getOpaqueId(value, 'id');
  const name = getTrimmedString(value, 'name', TIMELINE_VALIDATION_LIMITS.nameLength);
  const createdAt = getIsoTimestamp(value, 'createdAt');
  const updatedAt = getIsoTimestamp(value, 'updatedAt');
  if (id === null || id !== (expectedProjectId ?? id) || name === null || createdAt === null || updatedAt === null) {
    return null;
  }
  if (!isUnknownArray(value.assets)) {
    return null;
  }
  const assets: MediaAsset[] = [];
  const assetIds = new Set<string>();
  for (const rawAsset of value.assets) {
    const asset = parseAsset(rawAsset);
    if (asset === null || assetIds.has(asset.id)) {
      return null;
    }
    assetIds.add(asset.id);
    assets.push(asset);
  }
  const ai = aiValue === undefined
    ? createEmptyAiProjectDocument()
    : parseAiProjectDocument(aiValue, assetIds);
  if (ai === null) {
    return null;
  }
  return findInvalidAssetRelation(timeline, assets) === null
    ? { schemaVersion: PROJECT_SCHEMA_VERSION, id, name, createdAt, updatedAt, assets, timeline, ai }
    : null;
}

export function parsePersistedProject(value: unknown, expectedProjectId?: string): LocalProjectSnapshot | null {
  if (
    !isPlainRecord(value) ||
    !hasAllowedKeys(value, ['schemaVersion', 'id', 'name', 'createdAt', 'updatedAt', 'assets', 'timeline', 'ai']) ||
    value.schemaVersion !== PROJECT_SCHEMA_VERSION ||
    value.ai === undefined
  ) {
    return null;
  }
  const timeline = parseTimelineDocument(value.timeline);
  return timeline === null ? null : parseProjectRecord(value, timeline, value.ai, expectedProjectId);
}

export function parsePersistedProjectForRead(value: unknown, expectedProjectId?: string): LocalProjectSnapshot | null {
  const current = parsePersistedProject(value, expectedProjectId);
  if (current !== null) {
    return current;
  }
  if (
    !isPlainRecord(value) ||
    !hasAllowedKeys(value, ['schemaVersion', 'id', 'name', 'createdAt', 'updatedAt', 'assets', 'timeline']) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3)
  ) {
    return null;
  }
  const timeline = value.schemaVersion === 1
    ? migrateTimelineDocumentV1(value.timeline)
    : value.schemaVersion === 2
      ? migrateTimelineDocumentV2(value.timeline)
      : parseTimelineDocument(value.timeline);
  return timeline === null ? null : parseProjectRecord(value, timeline, undefined, expectedProjectId);
}
