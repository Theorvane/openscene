import { extname } from 'node:path';

import type { MediaAsset, MediaKind } from '../shared/timelineTypes';

export const PROJECT_ASSETS_DIRECTORY = 'assets';

const SUPPORTED_ASSET_FORMATS = [
  { extension: '.webm', kind: 'video', mimeType: 'video/webm' },
  { extension: '.mp4', kind: 'video', mimeType: 'video/mp4' },
  { extension: '.mov', kind: 'video', mimeType: 'video/quicktime' },
  { extension: '.webm', kind: 'audio', mimeType: 'audio/webm' },
  { extension: '.wav', kind: 'audio', mimeType: 'audio/wav' },
  { extension: '.mp3', kind: 'audio', mimeType: 'audio/mpeg' },
  { extension: '.m4a', kind: 'audio', mimeType: 'audio/mp4' },
  { extension: '.png', kind: 'image', mimeType: 'image/png' },
  { extension: '.jpg', kind: 'image', mimeType: 'image/jpeg' },
  { extension: '.jpeg', kind: 'image', mimeType: 'image/jpeg' },
  { extension: '.webp', kind: 'image', mimeType: 'image/webp' }
] as const;

export type SupportedAssetFormat = (typeof SUPPORTED_ASSET_FORMATS)[number];

export function supportedAssetFormatForExtension(extension: string, kind?: MediaKind): SupportedAssetFormat | null {
  if (kind !== undefined) {
    return SUPPORTED_ASSET_FORMATS.find((candidate) => candidate.extension === extension && candidate.kind === kind) ?? null;
  }
  return SUPPORTED_ASSET_FORMATS.find((candidate) => candidate.extension === extension && candidate.kind === 'video') ??
    SUPPORTED_ASSET_FORMATS.find((candidate) => candidate.extension === extension) ??
    null;
}

export function supportedAssetDialogExtensions(): readonly string[] {
  return [...new Set(SUPPORTED_ASSET_FORMATS.map((format) => format.extension.slice(1)))]
    .sort((left, right) => left.localeCompare(right));
}

export function supportedAssetExtension(extension: string, kind: MediaKind, mimeType: string): string | null {
  const format = SUPPORTED_ASSET_FORMATS.find(
    (candidate) => candidate.extension === extension && candidate.kind === kind && candidate.mimeType === mimeType
  );
  return format?.extension ?? null;
}

export function hasDeterministicAssetPath(asset: MediaAsset): boolean {
  const extension = extname(asset.projectRelativePath).toLowerCase();
  const format = SUPPORTED_ASSET_FORMATS.find((candidate) =>
    candidate.extension === extension && candidate.kind === asset.kind && candidate.mimeType === asset.mimeType
  );
  return (
    format !== undefined &&
    asset.projectRelativePath === `${PROJECT_ASSETS_DIRECTORY}/${asset.id}/original${extension}`
  );
}
