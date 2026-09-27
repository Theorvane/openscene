import type { ReactElement } from 'react';

import { MediaLibrary, type MediaLibraryAsset } from '../../../../external/opencut/apps/web/src/components/editor/media-library';
import { formatBytes, formatDuration } from '../format';
import { countTimelineAssetUsage, DEFAULT_MEDIA_LIBRARY_FILTERS, mediaLibraryFiltersActive, mediaLibraryView, MEDIA_LIBRARY_SORTS, type MediaLibraryFilters } from '../../../shared/mediaLibraryView';
import type { MediaAsset } from '../../../shared/timelineTypes';
import { mediaAssetReady } from './editorTimelineView';
import type { TimelineEditorController } from './useTimelineEditor';

type AssetBinProps = {
  readonly editor: TimelineEditorController;
  readonly filter?: 'audio';
  readonly filters: MediaLibraryFilters;
  readonly onFiltersChange: (filters: MediaLibraryFilters) => void;
};

const TIMELINE_DRAG_TYPE = 'application/x-window-loom-timeline';

function durationLabel(asset: MediaAsset, failureMessage: string | undefined): string {
  if (failureMessage !== undefined) return failureMessage;
  if (asset.kind === 'image') return 'Still image';
  if (asset.metadata === null) return 'Reading metadata';
  return formatDuration(asset.metadata.durationMs);
}

export function AssetBin({ editor, filter, filters, onFiltersChange }: AssetBinProps): ReactElement {
  const project = editor.project;
  const usage = project === null ? new Map<string, number>() : countTimelineAssetUsage(project.timeline);
  const availableAssets = project?.assets.filter((asset) => filter !== 'audio' || asset.kind === 'audio') ?? [];
  const visibleAssets = mediaLibraryView(availableAssets, { ...filters, usage, durationMs: (asset) => asset.metadata?.durationMs ?? null });
  const assets: MediaLibraryAsset[] = visibleAssets.map((asset) => ({
    id: asset.id,
    displayName: asset.displayName,
    kind: asset.kind,
    byteLabel: formatBytes(asset.byteLength),
    durationLabel: durationLabel(asset, editor.metadataProbeFailuresByAssetId[asset.id]),
    usageCount: usage.get(asset.id) ?? 0,
    ready: mediaAssetReady(asset),
    ...(editor.metadataProbeFailuresByAssetId[asset.id] === undefined ? {} : { failureMessage: editor.metadataProbeFailuresByAssetId[asset.id] })
  }));

  return <MediaLibrary
    mode={filter === 'audio' ? 'audio' : 'media'}
    hasProject={project !== null}
    busy={editor.isBusy}
    availableCount={availableAssets.length}
    assets={assets}
    filters={filters}
    filtersActive={mediaLibraryFiltersActive(filters)}
    defaultFilters={DEFAULT_MEDIA_LIBRARY_FILTERS}
    sortOptions={MEDIA_LIBRARY_SORTS}
    selectedAssetId={editor.selectedAssetId}
    onFiltersChange={onFiltersChange}
    onImport={(kind) => { void editor.importAssets(kind === undefined ? undefined : [kind]); }}
    onSelect={(assetId) => {
      editor.setSelectedAssetId(assetId);
      editor.setSelectedClipId('');
    }}
    onPlace={editor.placeSelectedAsset}
    onActivateAsset={(assetId) => { void editor.placeAssetOnTimeline(assetId); }}
    onRetry={editor.retryAssetMetadataProbe}
    onAssetDragStart={(event, assetId) => {
      event.dataTransfer.setData(TIMELINE_DRAG_TYPE, JSON.stringify({ kind: 'asset', assetId }));
      event.dataTransfer.effectAllowed = 'copy';
    }}
  />;
}
