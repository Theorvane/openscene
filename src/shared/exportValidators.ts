import type { ExportJobActionInput, StartExportJobInput } from './exportTypes';
import { parseMetadataPrivacyMode } from './metadataPrivacy';
import { parseSubtitleDelivery } from './subtitleDelivery';

type PlainRecord = Record<string, unknown>;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const START_KEYS = new Set(['projectId', 'width', 'height', 'frameRate', 'subtitleDelivery', 'metadataPrivacyMode']);

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: PlainRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function opaqueId(record: PlainRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length <= 128 && OPAQUE_ID_PATTERN.test(value) ? value : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

export function parseStartExportJobInput(value: unknown): StartExportJobInput | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, START_KEYS)) {
    return null;
  }
  const projectId = opaqueId(value, 'projectId');
  if (projectId === null) {
    return null;
  }
  const hasWidth = value.width !== undefined;
  const hasHeight = value.height !== undefined;
  if (hasWidth !== hasHeight) {
    return null;
  }
  const width = hasWidth ? boundedInteger(value.width, 16, 7_680) : undefined;
  const height = hasHeight ? boundedInteger(value.height, 16, 4_320) : undefined;
  const frameRate = value.frameRate === undefined ? undefined : boundedInteger(value.frameRate, 1, 120);
  const subtitleDelivery = value.subtitleDelivery === undefined ? undefined : parseSubtitleDelivery(value.subtitleDelivery);
  const metadataPrivacyMode = value.metadataPrivacyMode === undefined ? undefined : parseMetadataPrivacyMode(value.metadataPrivacyMode);
  if (width === null || height === null || frameRate === null || subtitleDelivery === null || metadataPrivacyMode === null || (width !== undefined && width % 2 !== 0) || (height !== undefined && height % 2 !== 0)) {
    return null;
  }
  return {
    projectId,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(frameRate === undefined ? {} : { frameRate }),
    ...(subtitleDelivery === undefined ? {} : { subtitleDelivery }),
    ...(metadataPrivacyMode === undefined ? {} : { metadataPrivacyMode })
  };
}

export function parseExportJobActionInput(value: unknown): ExportJobActionInput | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['jobId']))) {
    return null;
  }
  const jobId = opaqueId(value, 'jobId');
  return jobId === null ? null : { jobId };
}
