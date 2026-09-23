import { useEffect, useState, type ReactNode } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { PRODUCTION_LANES, productionEditorItems, type ProductionEditorAsset, type ProductionEditorItem } from '../../shared/productionEditor';

function MediaPreview({ projectId, item, kind }: { projectId: string; item: ProductionEditorItem; kind: string | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (item.assetId) void window.videoTool.getAssetPlaybackUrl({ projectId, assetId: item.assetId }).then(result => {
      if (current && result.ok) setUrl(result.value.url);
    }).catch(() => {});
    return () => { current = false; };
  }, [projectId, item.assetId]);
  if (!url) return <div className="production-preview-empty">{item.assetId || item.recipeId ? 'Preview unavailable. Your saved prompt is still here.' : item.lane === 'subtitles' ? item.prompt : 'This shot is waiting for a generated video.'}</div>;
  return kind === 'audio' ? <audio controls src={url} /> : <video controls preload="metadata" src={url} />;
}
export function PromptProductionLayout({ children, document, assets, projectId, busy, active, onLoad }: {
  children: ReactNode; document: AiProjectDocument | null | undefined; assets: readonly ProductionEditorAsset[];
  projectId: string | null | undefined; busy: boolean; active: boolean; onLoad: (item: ProductionEditorItem) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const items = document ? productionEditorItems(document, assets) : [];
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  return <div className="prompt-production-editor">
    <div className="production-prompt-pane">{children}</div>
    <aside className="production-preview" aria-label="Production preview">
      <header><span>PROGRAM / SELECTED SHOT</span><h2>{selected?.label ?? 'Your story starts here'}</h2></header>
      {active && selected && projectId ? <MediaPreview key={projectId + selected.id + selected.assetId} projectId={projectId} item={selected} kind={assets.find(asset => asset.id === selected.assetId)?.kind} /> : <div className="production-preview-empty">Write a prompt on the left or plan scenes in Writer. Saved results appear here.</div>}
      {selected && <div className="production-selection-details"><strong>{selected.status}</strong><p>{selected.prompt || 'No saved prompt for this media.'}</p>
        {(selected.shotId || selected.recipeId) && <button className="button" disabled={busy} onClick={() => onLoad(selected)}>Edit selected prompt</button>}
      </div>}
      <p className="production-preview-note">Selection previews one source, not the final composite. Loading a prompt never starts generation.</p>
    </aside>
    <section className="production-track-deck" aria-label="Production tracks">
      <header><strong>Sequence plan</strong><span>Video · Voice · Subtitles — select to inspect</span></header>
      {PRODUCTION_LANES.map(lane => <div className="production-track-row" key={lane}>
        <strong className="production-track-label">{lane}</strong>
        <div className="production-track-items" role="group" aria-label={lane + ' track'}>
          {items.filter(item => item.lane === lane).map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id}
            className={'production-track-item production-track-item--' + lane} onClick={() => setSelectedId(item.id)}>
            <small>{item.startMs === undefined ? 'Unplaced' : (item.startMs / 1000).toFixed(1) + 's'}{item.durationMs === undefined ? '' : ' · ' + (item.durationMs / 1000).toFixed(1) + 's'}</small>
            <span>{item.label}</span><small>{item.status}</small>
          </button>)}
          {!items.some(item => item.lane === lane) && <p className="production-track-empty">{lane === 'video' ? 'Plan a shot or generate your first take.' : lane === 'voice' ? 'Saved audio will appear here. Add voice in the Voice tool.' : 'Create a narration plan in Voice to see timed captions.'}</p>}
        </div>
      </div>)}
      <small>Times describe the plan. Unplaced takes and audio are not automatically synchronized.</small>
    </section>
  </div>;
}
