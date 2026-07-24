import type { ReactElement } from 'react';

import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS } from '../../../shared/timelineTypes';
import { formatDuration, formatTimestamp } from '../format';
import { Button, MetadataList, PanelHeading, StatusCard, TabPanel, Tabs } from '../ui';
import type { TabDefinition } from '../ui';
import {
  effectDbToVolume,
  effectPercentToOpacity,
  effectPercentToScale,
  effectUnitToPercent,
  effectVolumeToDb
} from './clipEffectControls';
import type { InspectorTabId } from './TimelineEditor';
import type { TimelineEditorController } from './useTimelineEditor';

type InspectorPanelProps = {
  readonly activeTabId: InspectorTabId;
  readonly editor: TimelineEditorController;
  readonly onActiveTabChange: (tabId: InspectorTabId) => void;
  readonly tabs: readonly TabDefinition<InspectorTabId>[];
};

type InspectorContentProps = {
  readonly editor: TimelineEditorController;
};

function SelectionInspector({ editor }: InspectorContentProps): ReactElement {
  const clip = editor.selectedClip;
  const effects = clip?.clip.effects ?? DEFAULT_CLIP_EFFECTS;
  const opacityPercent = effectUnitToPercent(effects.opacity);
  const scalePercent = effectUnitToPercent(effects.scale);
  const volumeDb = effectVolumeToDb(effects.volume);

  return (
    <section className="clip-controls" aria-label="Selected clip controls">
      <div>
        <p className="section-kicker">Clip</p>
        <h3 style={{ fontSize: 'var(--text-subhead)', fontWeight: 600, color: 'var(--foreground)' }}>
          {clip === null ? 'No clip selected' : clip.asset?.displayName ?? 'Missing asset'}
        </h3>
      </div>

      {editor.project === null ? (
        <div className="empty-slate">Create or open a project before editing clips.</div>
      ) : clip === null ? (
        <div className="empty-slate">Select a timeline clip to nudge, trim, split, or delete it.</div>
      ) : (
        <>
          <div className="transport-strip__buttons" role="toolbar" aria-label="Selected clip trim controls" style={{ gap: '4px', margin: 'var(--space-2) 0' }}>
            <Button onClick={() => editor.moveSelectedClip(-500)}>Nudge -0.5s</Button>
            <Button onClick={() => editor.moveSelectedClip(500)}>Nudge +0.5s</Button>
            <Button onClick={() => editor.trimSelectedClip('left', 500)}>Trim left</Button>
            <Button onClick={() => editor.trimSelectedClip('right', -500)}>Trim right</Button>
            <Button onClick={editor.splitSelectedClip}>Split middle</Button>
            <Button variant="stop" onClick={editor.deleteSelectedClip}>Delete clip</Button>
          </div>
          <MetadataList
            className="editor-meta"
            items={[
              { term: 'Track', description: clip.track.name },
              { term: 'Start', description: formatDuration(clip.clip.timelineStartMs) },
              { term: 'Source in', description: formatDuration(clip.clip.sourceStartMs) },
              { term: 'Source out', description: formatDuration(clip.clip.sourceEndMs) }
            ]}
          />

          <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
            <h4 style={{ fontSize: 'var(--text-micro)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--primary)', margin: '0 0 var(--space-2)' }}>
              Effect Controls
            </h4>
            
            {/* Motion Parameters */}
            <div style={{ background: 'var(--surface-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--muted-foreground)', marginBottom: 'var(--space-2)' }}>
                📁 Motion (Transform)
              </div>
              
              {/* Position */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
	                <span style={{ fontSize: '11px', color: 'var(--foreground)' }}>Position</span>
	                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
	                  <span style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>X:</span>
		                  <input 
		                    type="number" 
		                    aria-label="Clip effect position X"
		                    value={effects.positionX} 
		                    min={CLIP_EFFECT_RANGES.positionX.min}
		                    max={CLIP_EFFECT_RANGES.positionX.max}
	                    onChange={(event) => editor.updateSelectedClipEffects({ positionX: Number(event.currentTarget.value) })} 
	                    style={{ width: '42px', background: 'transparent', border: 'none', borderBottom: '1px dotted var(--accent)', fontSize: '10px', color: 'var(--accent)', padding: '1px 3px', textAlign: 'center', cursor: 'ew-resize' }} 
	                  />
	                  <span style={{ fontSize: '9px', color: 'var(--muted-foreground)', marginLeft: '4px' }}>Y:</span>
		                  <input 
		                    type="number" 
		                    aria-label="Clip effect position Y"
		                    value={effects.positionY} 
		                    min={CLIP_EFFECT_RANGES.positionY.min}
		                    max={CLIP_EFFECT_RANGES.positionY.max}
	                    onChange={(event) => editor.updateSelectedClipEffects({ positionY: Number(event.currentTarget.value) })} 
	                    style={{ width: '42px', background: 'transparent', border: 'none', borderBottom: '1px dotted var(--accent)', fontSize: '10px', color: 'var(--accent)', padding: '1px 3px', textAlign: 'center', cursor: 'ew-resize' }} 
	                  />
	                </div>
	              </div>

              {/* Scale */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--foreground)' }}>Scale</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
	                  <input 
		                    type="range" 
		                    aria-label="Clip effect scale"
		                    min={CLIP_EFFECT_RANGES.scale.min * 100} 
		                    max={CLIP_EFFECT_RANGES.scale.max * 100} 
	                    value={scalePercent} 
	                    onChange={(event) => editor.updateSelectedClipEffects({ scale: effectPercentToScale(Number(event.currentTarget.value)) })} 
	                    style={{ flex: 1, accentColor: 'var(--primary)', height: '3px', cursor: 'ew-resize' }} 
	                  />
	                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', minWidth: '32px', textAlign: 'right', color: 'var(--accent)', borderBottom: '1px dotted var(--accent)', cursor: 'ew-resize', padding: '0 2px', userSelect: 'none' }}>{scalePercent}%</span>
	                </div>
	              </div>

              {/* Rotation */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--foreground)' }}>Rotation</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
	                  <input 
	                    type="range" 
	                    aria-label="Clip effect rotation"
	                    min="0" 
	                    max="360" 
	                    value={effects.rotation} 
	                    onChange={(event) => editor.updateSelectedClipEffects({ rotation: Number(event.currentTarget.value) })} 
	                    style={{ flex: 1, accentColor: 'var(--primary)', height: '3px', cursor: 'ew-resize' }} 
	                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                    {/* Circle Dial Visual */}
                    <div 
                      style={{
                        width: '13px',
                        height: '13px',
                        borderRadius: '50%',
                        border: '1px solid var(--accent)',
                        background: 'rgba(6, 182, 212, 0.05)',
                        position: 'relative',
                        flexShrink: 0
                      }}
                      title="Rotation Angle Indicator"
                    >
                      <div 
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          width: '1px',
                          height: '5px',
                          background: 'var(--accent)',
                          transformOrigin: '50% 100%',
	                          transform: `translate(-50%, -100%) rotate(${effects.rotation}deg)`
	                        }}
	                      />
	                    </div>
	                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', minWidth: '32px', textAlign: 'right', color: 'var(--accent)', borderBottom: '1px dotted var(--accent)', cursor: 'ew-resize', padding: '0 2px', userSelect: 'none' }}>{effects.rotation}°</span>
	                  </div>
	                </div>
	              </div>
            </div>

            {/* Opacity Parameters */}
            <div style={{ background: 'var(--surface-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--muted-foreground)', marginBottom: 'var(--space-2)' }}>
                📁 Opacity (Blend Mode)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--foreground)' }}>Opacity</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
	                  <input 
		                    type="range" 
		                    aria-label="Clip effect opacity"
		                    min={CLIP_EFFECT_RANGES.opacity.min * 100} 
		                    max={CLIP_EFFECT_RANGES.opacity.max * 100} 
	                    value={opacityPercent} 
	                    onChange={(event) => editor.updateSelectedClipEffects({ opacity: effectPercentToOpacity(Number(event.currentTarget.value)) })} 
	                    style={{ flex: 1, accentColor: 'var(--primary)', height: '3px', cursor: 'ew-resize' }} 
	                  />
	                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', minWidth: '32px', textAlign: 'right', color: 'var(--accent)', borderBottom: '1px dotted var(--accent)', cursor: 'ew-resize', padding: '0 2px', userSelect: 'none' }}>{opacityPercent}%</span>
	                </div>
	              </div>
            </div>

            {/* Audio Effects Parameters */}
            <div style={{ background: 'var(--surface-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--muted-foreground)', marginBottom: 'var(--space-2)' }}>
                📁 Audio (Volume)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--foreground)' }}>Volume</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
	                  <input 
		                    type="range" 
		                    aria-label="Clip effect volume"
		                    min={CLIP_EFFECT_RANGES.volumeDb.min} 
		                    max={CLIP_EFFECT_RANGES.volumeDb.max} 
	                    value={volumeDb} 
	                    onChange={(event) => editor.updateSelectedClipEffects({ volume: effectDbToVolume(Number(event.currentTarget.value)) })} 
	                    style={{ flex: 1, accentColor: 'var(--primary)', height: '3px', cursor: 'ew-resize' }} 
	                  />
	                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', minWidth: '32px', textAlign: 'right', color: 'var(--accent)', borderBottom: '1px dotted var(--accent)', cursor: 'ew-resize', padding: '0 2px', userSelect: 'none' }}>
	                    {volumeDb} dB
	                  </span>
	                </div>
	              </div>
	            </div>
	          </div>
        </>
      )}

      {editor.activePlaybackClip !== null && (
        <MetadataList
          className="editor-meta"
          items={[
            { term: 'Playhead', description: formatDuration(editor.playheadMs) },
            { term: 'Source time', description: formatDuration(editor.activePlaybackClip.sourceTimeMs) }
          ]}
        />
      )}
    </section>
  );
}

function AssetInspector({ editor }: InspectorContentProps): ReactElement {
  const asset = editor.selectedAsset;

  if (editor.project === null) {
    return <div className="empty-slate">Create or open a project before inspecting asset metadata.</div>;
  }

  if (asset === null) {
    return <div className="empty-slate">Select an imported asset to inspect its local metadata.</div>;
  }

  return (
    <section className="clip-controls" aria-label="Selected asset metadata">
      <div>
        <p className="section-kicker">Asset</p>
        <h3>{asset.displayName}</h3>
      </div>
      <MetadataList
        className="editor-meta"
        items={[
          { term: 'Imported', description: formatTimestamp(asset.createdAt) },
          { term: 'Kind', description: asset.kind },
          { term: 'Duration', description: asset.metadata === null ? 'Pending' : formatDuration(asset.metadata.durationMs) }
        ]}
      />
    </section>
  );
}

function ProjectInspector({ editor }: InspectorContentProps): ReactElement {
  const project = editor.project;

  if (project === null) {
    return <div className="empty-slate">Create or open a project to see project controls.</div>;
  }

  return (
    <section className="clip-controls" aria-label="Current project controls">
      <div>
        <p className="section-kicker">Project</p>
        <h3>{project.name}</h3>
      </div>
      <MetadataList
        className="editor-meta"
        items={[
          { term: 'Created', description: formatTimestamp(project.createdAt) },
          { term: 'Updated', description: formatTimestamp(project.updatedAt) },
          { term: 'Assets', description: project.assets.length },
          { term: 'Tracks', description: project.timeline.tracks.length }
        ]}
      />
      <Button variant="ghost" onClick={() => void editor.deleteCurrentProject()} disabled={editor.isBusy}>Delete project</Button>
    </section>
  );
}

export function InspectorPanel({ activeTabId, editor, onActiveTabChange, tabs }: InspectorPanelProps): ReactElement {
  return (
    <aside className="inspector-panel" aria-labelledby="inspector-title">
      <PanelHeading>
        <div>
          <p className="section-kicker">Inspector</p>
          <h2 id="inspector-title">Selection, asset, and project</h2>
        </div>
      </PanelHeading>

      <Tabs activeTabId={activeTabId} idBase="inspector" tabs={tabs} onActiveTabChange={onActiveTabChange} aria-label="Inspector sections" />

      <div className="inspector-panel__content">
        <TabPanel activeTabId={activeTabId} idBase="inspector" tabId="selection">
          <SelectionInspector editor={editor} />
        </TabPanel>

        <TabPanel activeTabId={activeTabId} idBase="inspector" tabId="asset">
          <AssetInspector editor={editor} />
        </TabPanel>

        <TabPanel activeTabId={activeTabId} idBase="inspector" tabId="project">
          <ProjectInspector editor={editor} />
        </TabPanel>
      </div>

      <StatusCard tone={editor.statusMessage.tone}>{editor.statusMessage.text}</StatusCard>
    </aside>
  );
}
