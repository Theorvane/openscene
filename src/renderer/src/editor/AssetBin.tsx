import type { CSSProperties, ReactElement } from 'react';

import { formatBytes, formatDuration } from '../format';
import type { TimelineEditorController } from './useTimelineEditor';

type AssetBinProps = {
  readonly editor: TimelineEditorController;
};

const TIMELINE_DRAG_TYPE = 'application/x-window-loom-timeline';

const COMPACT_PANEL_STYLE = {
  gap: 'var(--space-2)',
  padding: 'var(--space-3)'
} as const satisfies CSSProperties;

const COMPACT_PANEL_HEADING_STYLE = {
  alignItems: 'center'
} as const satisfies CSSProperties;

const COMPACT_PANEL_TITLE_STYLE = {
  fontSize: 'var(--text-subhead)',
  letterSpacing: '-0.03em',
  lineHeight: 1.12,
  margin: 0
} as const satisfies CSSProperties;

const ASSET_CARD_ENTRY_STYLE = {
  display: 'grid',
  gap: 'var(--space-2)'
} as const satisfies CSSProperties;

export function AssetBin({ editor }: AssetBinProps): ReactElement {
  const project = editor.project;

  return (
    <section className="asset-bin" aria-labelledby="assets-title" style={COMPACT_PANEL_STYLE}>
      <div className="panel-heading" style={COMPACT_PANEL_HEADING_STYLE}>
        <div>
          <p className="section-kicker">Media Dock</p>
          <h2 id="assets-title" style={COMPACT_PANEL_TITLE_STYLE}>Media Bin</h2>
        </div>
        <div className="transport-strip__buttons">
          <button className="button" type="button" onClick={() => void editor.importAssets(['video'])} disabled={project === null || editor.isBusy}>Import video</button>
          <button className="button" type="button" onClick={() => void editor.importAssets(['audio'])} disabled={project === null || editor.isBusy}>Import audio</button>
          <button className="button button--primary" type="button" onClick={editor.placeSelectedAsset} disabled={editor.selectedAsset?.metadata === null || editor.selectedAsset === null}>Place on timeline</button>
        </div>
      </div>

      {project === null ? (
        <div className="empty-slate">Create or open a project before importing local media.</div>
      ) : (
        <div className="asset-grid" aria-label="Imported project assets">
          {project.assets.map((asset) => {
            const failureMessage = editor.metadataProbeFailuresByAssetId[asset.id];
            const selected = editor.selectedAssetId === asset.id;

            return (
              <div key={asset.id} style={ASSET_CARD_ENTRY_STYLE}>
                <button
                  className={`asset-card${selected ? ' asset-card--selected' : ''}`}
                  draggable={asset.metadata !== null}
                  type="button"
                  onClick={() => editor.setSelectedAssetId(asset.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TIMELINE_DRAG_TYPE, JSON.stringify({ kind: 'asset', assetId: asset.id }));
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <span className={`asset-card__kind asset-card__kind--${asset.kind}`}>{asset.kind}</span>
                  <strong>{asset.displayName}</strong>
                  <small>{formatBytes(asset.byteLength)}</small>
                  <span>{failureMessage ?? (asset.metadata === null ? 'Reading metadata' : formatDuration(asset.metadata.durationMs))}</span>
                </button>
                {selected && failureMessage !== undefined ? (
                  <button className="button" type="button" onClick={() => editor.retryAssetMetadataProbe(asset.id)}>Retry metadata</button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
