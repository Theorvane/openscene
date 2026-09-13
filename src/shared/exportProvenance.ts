import type { ProvenanceRecord } from './aiProjectDomain';
import { metadataPrivacyPlan, type MetadataPrivacyMode, type MetadataPrivacyVerification } from './metadataPrivacy';
import type { SubtitleDelivery } from './subtitleDelivery';
import type { LocalProjectSnapshot, TimelineDocument } from './timelineTypes';

export const DELIVERY_PROVENANCE_SCHEMA_VERSION = 2 as const;

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL_SHAPED_ID = /^(?:AIza|sk-(?:proj-)?|xai-|gh[pousr]_|A(?:KI|SI)A)|(?:api[_-]?key|access[_-]?token|credential|secret)/i;

export type DeliveryLineageRecord = {
  readonly id: string;
  readonly source: ProvenanceRecord['source'];
  readonly createdAt: string;
  readonly inputAssetIds: readonly string[];
  readonly outputAssetIds: readonly string[];
  readonly transformHistoryFingerprints: readonly string[];
  readonly rightsRecorded: boolean;
  readonly rightsNoteFingerprint?: string;
  readonly providerId?: string;
  readonly modelId?: string;
};

export type DeliveryProvenance = {
  readonly schemaVersion: typeof DELIVERY_PROVENANCE_SCHEMA_VERSION;
  readonly projectRevision: {
    readonly projectId: string;
    readonly projectUpdatedAt: string;
    readonly projectSchemaVersion: number;
    readonly timelineSchemaVersion: number;
    readonly aiSchemaVersion: number;
    readonly timelineFingerprint: string;
  };
  readonly delivery: {
    readonly exportedAt: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly durationMs: number;
    readonly subtitleDelivery: SubtitleDelivery;
    readonly metadataPrivacyMode: MetadataPrivacyMode;
    /** Closed allowlist requested from FFmpeg; actual observations are kept separately. */
    readonly requestedContainerMetadataKeys: readonly string[];
    readonly metadataPrivacyVerification: MetadataPrivacyVerification;
    /** Signal classes not explicitly targeted by the sanitizer; not a survival guarantee across transcoding. */
    readonly untargetedSignalClasses: readonly string[];
    readonly output: {
      readonly fileName: string;
      readonly fileSizeBytes: number;
      readonly sha256: string;
    };
  };
  readonly lineage: readonly DeliveryLineageRecord[];
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function fingerprint(value: unknown): string {
  const source = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function timelineRevisionFingerprint(timeline: TimelineDocument): string {
  return fingerprint(timeline);
}

function safePublicId(value: string | undefined): string | undefined {
  return value !== undefined && PUBLIC_ID.test(value) && !CREDENTIAL_SHAPED_ID.test(value) ? value : undefined;
}

function lineageRecord(record: ProvenanceRecord): DeliveryLineageRecord {
  const providerId = safePublicId(record.providerId);
  const modelId = safePublicId(record.modelId);
  const rightsRecorded = (record.rightsNote?.trim().length ?? 0) > 0;
  return {
    id: record.id,
    source: record.source,
    createdAt: record.createdAt,
    inputAssetIds: record.inputAssetIds,
    outputAssetIds: record.outputAssetIds,
    transformHistoryFingerprints: record.transformHistory.map(fingerprint),
    rightsRecorded,
    ...(rightsRecorded ? { rightsNoteFingerprint: fingerprint(record.rightsNote) } : {}),
    ...(providerId === undefined ? {} : { providerId }),
    ...(modelId === undefined ? {} : { modelId })
  };
}

/**
 * Keep the delivery manifest scoped to the media that actually contributes to
 * the exported cut. Walking backwards through input assets preserves useful
 * ancestry without disclosing unrelated experiments stored in the project.
 */
function deliveryLineage(project: LocalProjectSnapshot): readonly ProvenanceRecord[] {
  const requiredAssetIds = new Set(
    project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId))
  );
  const includedIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of project.ai.provenance) {
      if (includedIds.has(record.id) || !record.outputAssetIds.some((assetId) => requiredAssetIds.has(assetId))) continue;
      includedIds.add(record.id);
      for (const assetId of record.inputAssetIds) requiredAssetIds.add(assetId);
      changed = true;
    }
  }
  return project.ai.provenance.filter((record) => includedIds.has(record.id));
}

export function createDeliveryProvenance(input: {
  readonly project: LocalProjectSnapshot;
  readonly exportedAt: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationMs: number;
  readonly subtitleDelivery: SubtitleDelivery;
  readonly metadataPrivacyMode: MetadataPrivacyMode;
  readonly metadataPrivacyVerification: MetadataPrivacyVerification;
  readonly output: { readonly fileName: string; readonly fileSizeBytes: number; readonly sha256: string };
}): DeliveryProvenance {
  const plan = metadataPrivacyPlan(input.metadataPrivacyMode);
  return {
    schemaVersion: DELIVERY_PROVENANCE_SCHEMA_VERSION,
    projectRevision: {
      projectId: input.project.id,
      projectUpdatedAt: input.project.updatedAt,
      projectSchemaVersion: input.project.schemaVersion,
      timelineSchemaVersion: input.project.timeline.schemaVersion,
      aiSchemaVersion: input.project.ai.schemaVersion,
      timelineFingerprint: timelineRevisionFingerprint(input.project.timeline)
    },
    delivery: {
      exportedAt: input.exportedAt,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      durationMs: input.durationMs,
      subtitleDelivery: input.subtitleDelivery,
      metadataPrivacyMode: input.metadataPrivacyMode,
      requestedContainerMetadataKeys: plan.removedFields.map((field) => field.key),
      metadataPrivacyVerification: input.metadataPrivacyVerification,
      untargetedSignalClasses: plan.untargetedSignals,
      output: input.output
    },
    lineage: deliveryLineage(input.project).map(lineageRecord)
  };
}

export function createDeliveryProvenanceSidecar(provenance: DeliveryProvenance): {
  readonly extension: 'provenance.json';
  readonly contents: string;
} {
  return {
    extension: 'provenance.json',
    contents: `${JSON.stringify(provenance, null, 2)}\n`
  };
}
