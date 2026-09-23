import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { useProjectResultImport } from './ProjectResultImportContext';
import { PRODUCTION_LANES, inspectProductionTime, isTimedProductionItem, productionPlanDuration, productionReadiness, productionEditorItems, type ProductionEditorAsset, type ProductionEditorItem } from '../../shared/productionEditor';

function MediaPreview({ projectId, item, kind, offsetMs }: { projectId: string; item: ProductionEditorItem; kind: string | undefined; offsetMs: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const seek = () => {
    const video = videoRef.current ?? audioRef.current;
    if (video && video.readyState >= 1 && Number.isFinite(video.duration)) { video.pause(); video.currentTime = Math.min(offsetMs / 1000, Math.max(0, video.duration - .001)); }
  };
  useEffect(seek, [offsetMs]);
  useEffect(() => {
    let current = true;
    if (item.assetId) void window.videoTool.getAssetPlaybackUrl({ projectId, assetId: item.assetId }).then(result => {
      if (current && result.ok) setUrl(result.value.url);
    }).catch(() => {});
    return () => { current = false; };
  }, [projectId, item.assetId]);
  if (!url) return <div className="production-preview-empty">{item.assetId || item.recipeId ? item.prompt ? 'Preview unavailable. Your saved prompt is still here.' : 'Source preview unavailable.' : item.lane === 'subtitles' ? item.prompt : 'This shot is waiting for a generated video.'}</div>;
  return kind === 'audio' ? <audio ref={audioRef} onLoadedMetadata={seek} controls src={url} /> : <video ref={videoRef} onLoadedMetadata={seek} controls preload="metadata" src={url} />;
}
export function PromptProductionLayout({ children, document, assets, projectId, busy, active, onLoad }: {
  children: ReactNode; document: AiProjectDocument | null | undefined; assets: readonly ProductionEditorAsset[];
  projectId: string | null | undefined; busy: boolean; active: boolean; onLoad: (item: ProductionEditorItem) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const { timeline, hasUnsavedTimeline, saveTimeline, placeAiAssetOnTimeline, isImporting } = useProjectResultImport();
  const [placementMessage, setPlacementMessage] = useState('');
  const [inspectionMs, setInspectionMs] = useState<number | null>(null);
  const items = document ? productionEditorItems(document, assets, timeline) : [];
  const inspection = inspectProductionTime(items, inspectionMs ?? 0);
  const selected = inspectionMs === null ? items.find(item => item.id === selectedId) ?? items[0] : inspection.video;
  const durationMs = productionPlanDuration(items);
  const readiness = productionReadiness(items);
  const select = (item: ProductionEditorItem) => { setInspectionMs(null); setSelectedId(item.id); };
  return <div className="prompt-production-editor">
    <div className="production-prompt-pane">{children}</div>
    <aside className="production-preview" aria-label="Production preview">
      <header><span>PROGRAM / SELECTED SHOT</span><h2>{selected?.label ?? 'Your story starts here'}</h2></header>
      {active && selected && projectId ? <MediaPreview key={projectId + selected.id + selected.assetId} projectId={projectId} item={selected} offsetMs={inspectionMs === null ? selected.sourceStartMs ?? 0 : inspection.sourceOffsetMs} kind={assets.find(asset => asset.id === selected.assetId)?.kind} /> : <div className="production-preview-empty">{inspectionMs === null ? 'Write a prompt on the left or plan scenes in Writer. Saved results appear here.' : 'No planned video at this time.'}</div>}
      {inspectionMs !== null && <p className="production-caption-inspection" aria-live="polite">Caption at inspected time: {inspection.captions.map(item => item.prompt).join(' ') || 'None'}</p>}
      {selected && <div className="production-selection-details"><strong>{selected.status}</strong><p>{selected.prompt || 'No saved prompt for this media.'}</p>
        {(selected.shotId || selected.recipeId) && <button className="button" disabled={busy} onClick={() => onLoad(selected)}>Edit selected prompt</button>}
        {selected.lane === 'voice' && selected.assetId && selected.startMs === undefined && <button className="button" disabled={busy || isImporting} onClick={() => {
          setPlacementMessage(placeAiAssetOnTimeline(selected.assetId!) ? 'Voice appended to the audio track. Save arrangement to keep this placement.' : 'Could not place audio. Check media duration and available audio track.');
        }}>Append voice to audio track</button>}
      </div>}
      <p className="production-preview-note">Selection previews one source, not the final composite. Loading a prompt never starts generation.</p>
    </aside>
    <section className="production-track-deck" aria-label="Production tracks">
      <header><strong>Sequence plan</strong><span>Video · Voice · Subtitles — select to inspect</span></header>
      <button className="button" disabled={busy || isImporting || !hasUnsavedTimeline} onClick={() => { void saveTimeline().then(ok => setPlacementMessage(ok ? 'Arrangement saved locally.' : 'Save failed. Your arrangement is still unsaved.')); }}>Save arrangement{hasUnsavedTimeline ? ' · Unsaved changes' : ''}</button>
      {placementMessage && <p role="status">{placementMessage}</p>}
      <p className="production-readiness">{readiness.total === 0 ? 'Start with Writer to create a timed shot plan.' : `${readiness.approved}/${readiness.total} shots approved · ${readiness.missing} missing media · ${readiness.review} need review`}</p>
      {durationMs > 0 && <label className="production-time-control">Inspect plan · {(inspection.timeMs / 1000).toFixed(1)} / {(durationMs / 1000).toFixed(1)}s
        <input aria-label="Inspect production time" type="range" min={0} max={durationMs} step={100} value={inspection.timeMs} onChange={event => setInspectionMs(Number(event.target.value))} />
      </label>}
      {PRODUCTION_LANES.map(lane => <div className="production-track-row" key={lane}>
        <strong className="production-track-label">{lane}</strong>
        <div className="production-track-items" role="group" aria-label={lane + ' track'}>
          {durationMs > 0 && <div className="production-timed-lane">
            {items.filter(item => item.lane === lane && isTimedProductionItem(item)).map(item => <button type="button" key={item.id}
              title={item.label} aria-label={`${item.label}, ${item.startMs! / 1000}s, ${item.durationMs! / 1000}s long`} aria-pressed={selected?.id === item.id}
              className={'production-track-item production-track-item--' + lane} style={{ left: `${item.startMs! / durationMs * 100}%`, width: `${item.durationMs! / durationMs * 100}%` }}
              onClick={() => item.lane === 'voice' ? select(item) : setInspectionMs(item.startMs!)}><span>{item.label}</span><small>{item.startMs! / 1000}s · {item.durationMs! / 1000}s</small></button>)}
            {inspectionMs !== null && <span className="production-playhead" style={{ left: `${inspection.timeMs / durationMs * 100}%` }} />}
          </div>}
          {items.some(item => item.lane === lane && !isTimedProductionItem(item)) && <small className="production-unplaced-label">Unplaced media — outside the plan</small>}
          {items.filter(item => item.lane === lane && !isTimedProductionItem(item)).map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id}
            className={'production-track-item production-track-item--' + lane} onClick={() => select(item)}>
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
