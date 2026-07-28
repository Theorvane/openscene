import { useState, type DragEvent, type ReactElement } from 'react';

import { formatDuration } from '../format';
import { buildTimelineView, clientXToTimelineMs } from './editorTimelineView';
import type { TimelineEditorController } from './useTimelineEditor';

type TimelineCanvasProps = {
  readonly editor: TimelineEditorController;
  readonly id?: string;
};

type TimelineDragPayload =
  | { readonly kind: 'asset'; readonly assetId: string }
  | { readonly kind: 'clip'; readonly clipId: string; readonly offsetMs: number }
  | { readonly kind: 'trim'; readonly clipId: string; readonly edge: 'left' | 'right' };

const TIMELINE_DRAG_TYPE = 'application/x-window-loom-timeline';

function readTimelineDrag(event: DragEvent): TimelineDragPayload | null {
  const raw = event.dataTransfer.getData(TIMELINE_DRAG_TYPE);
  if (raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) return null;
    return parsed as TimelineDragPayload;
  } catch {
    return null;
  }
}

function writeTimelineDrag(event: DragEvent, payload: TimelineDragPayload): void {
  event.dataTransfer.setData(TIMELINE_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'move';
}

// Decorative component for Audio track waveforms
function AudioWaveformBg(): ReactElement {
  return (
    <svg 
      style={{ position: 'absolute', inset: '8px 0', width: '100%', height: 'calc(100% - 16px)', opacity: 0.08, pointerEvents: 'none', color: 'var(--success)' }} 
      preserveAspectRatio="none" 
      viewBox="0 0 100 40"
    >
      <path 
        d="M 0,20 Q 2.5,2 5,38 T 10,20 T 15,10 T 20,35 T 25,20 T 30,5 T 35,38 T 40,20 T 45,15 T 50,30 T 55,20 T 60,3 T 65,37 T 70,20 T 75,12 T 80,32 T 85,20 T 90,8 T 95,35 T 100,20" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="1.5" 
      />
    </svg>
  );
}

// Decorative component for Video track film perforations
function VideoFilmstripBg(): ReactElement {
  return (
    <div 
      style={{ 
        position: 'absolute', 
        inset: 0, 
        opacity: 0.06, 
        pointerEvents: 'none', 
        backgroundImage: `
          repeating-linear-gradient(90deg, transparent, transparent 38px, var(--foreground) 38px, var(--foreground) 40px),
          repeating-linear-gradient(90deg, var(--foreground) 0px, var(--foreground) 3px, transparent 3px, transparent 9px)
        `, 
        backgroundSize: '100% 100%, 100% 5px', 
        backgroundPosition: '0 0, 0 3px, 0 calc(100% - 8px)'
      }} 
    />
  );
}

export function TimelineCanvas({ editor, id }: TimelineCanvasProps): ReactElement {
  const project = editor.project;
  const view = project === null ? null : buildTimelineView(project.timeline, project.assets);
  const playheadPercent = view === null ? 0 : (editor.playheadMs / view.durationMs) * 100;

  // UI/UX Enhancements: Zoom level, Track Mute/Solo/Lock, and active tool selection
  const [zoomLevel, setZoomLevel] = useState(1.5);
  const [activeTool, setActiveTool] = useState<'select' | 'razor' | 'hand' | 'text'>('select');
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({});
  const [soloTracks, setSoloTracks] = useState<Record<string, boolean>>({});
  const [lockedTracks, setLockedTracks] = useState<Record<string, boolean>>({});

  const onLaneDrop = (event: DragEvent<HTMLDivElement>, trackId: string): void => {
    if (view === null) return;
    event.preventDefault();
    const payload = readTimelineDrag(event);
    if (payload === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const atMs = clientXToTimelineMs({ clientX: event.clientX, laneLeft: rect.left, laneWidth: rect.width, durationMs: view.durationMs, snapMs: 100 });
    if (payload.kind === 'asset') editor.placeAssetOnTrack(payload.assetId, trackId, atMs);
    if (payload.kind === 'clip') editor.moveClipToTrack(payload.clipId, trackId, Math.max(0, atMs - payload.offsetMs));
    if (payload.kind === 'trim') editor.trimClipTo(payload.clipId, payload.edge, atMs);
  };

  const scrubLane = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (view === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    editor.setPlayheadMs(clientXToTimelineMs({ clientX: event.clientX, laneLeft: rect.left, laneWidth: rect.width, durationMs: view.durationMs, snapMs: 100 }));
  };

  return (
    <section id={id} className="timeline-panel editor-timeline-region" aria-labelledby="timeline-title" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: 0, padding: 0 }}>
      {/* Timeline Header with zoom controls */}
      <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="section-kicker">Timeline</p>
          <h2 id="timeline-title" style={{ fontSize: '1.0rem', fontWeight: 600 }}>Edit Assembly</h2>
        </div>

        {/* Dynamic Zoom Slider */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--space-2)', 
            background: 'var(--input)', 
            padding: '2px 6px', 
            borderRadius: 'var(--radius-sm)', 
            border: '1px solid var(--border)' 
          }}
        >
          <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-muted)' }}>Scale:</span>
          <input 
            type="range" 
            min="1" 
            max="5" 
            step="0.5"
            value={zoomLevel} 
            onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
            style={{ width: '80px', accentColor: 'var(--primary)', cursor: 'ew-resize' }}
            title="Adjust timeline zoom level"
          />
          <span style={{ fontSize: 'var(--text-micro)', fontFamily: 'var(--font-mono)', minWidth: '22px', textAlign: 'right' }}>
            {zoomLevel.toFixed(1)}x
          </span>
        </div>
      </div>

      {project === null || view === null ? (
        <div className="timeline-empty">Open a project to see editable local tracks.</div>
      ) : (
        /* Reorganized Layout: Left vertical toolbox & Right scrollable track stack */
        <div style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', height: '100%', minHeight: 0 }}>
          
          {/* 1. Left Vertical Toolbox */}
          <div 
            style={{ 
              background: 'var(--surface-raised-soft)',
              borderRight: '1px solid var(--border)', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              paddingTop: 'var(--space-2)', 
              gap: '4px'
            }}
          >
            <button 
              type="button"
              onClick={() => setActiveTool('select')}
              style={{
                width: '26px',
                height: '26px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: activeTool === 'select' ? 'var(--primary)' : 'transparent',
                color: activeTool === 'select' ? 'var(--primary-foreground)' : 'var(--foreground)',
                cursor: 'pointer',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background var(--transition-fast)'
              }}
              title="Selection Tool (V)"
            >
              ↖
            </button>
            <button 
              type="button"
              onClick={() => setActiveTool('razor')}
              style={{
                width: '26px',
                height: '26px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: activeTool === 'razor' ? 'var(--primary)' : 'transparent',
                color: activeTool === 'razor' ? 'var(--primary-foreground)' : 'var(--foreground)',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background var(--transition-fast)'
              }}
              title="Razor Cut Tool (C)"
            >
              ✂
            </button>
            <button 
              type="button"
              onClick={() => setActiveTool('hand')}
              style={{
                width: '26px',
                height: '26px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: activeTool === 'hand' ? 'var(--primary)' : 'transparent',
                color: activeTool === 'hand' ? 'var(--primary-foreground)' : 'var(--foreground)',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background var(--transition-fast)'
              }}
              title="Hand Tool (H)"
            >
              ✋
            </button>
            <button 
              type="button"
              onClick={() => setActiveTool('text')}
              style={{
                width: '26px',
                height: '26px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: activeTool === 'text' ? 'var(--primary)' : 'transparent',
                color: activeTool === 'text' ? 'var(--primary-foreground)' : 'var(--foreground)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background var(--transition-fast)'
              }}
              title="Type Tool (T)"
            >
              T
            </button>
          </div>

          {/* 2. Right Scrollable Track Stack */}
          <div className="timeline-stack" style={{ overflowX: 'auto', position: 'relative', height: '100%' }}>
            {/* Scrollable Container based on zoomLevel */}
            <div style={{ width: `calc(100% * ${zoomLevel})`, minWidth: '100%', position: 'relative', display: 'grid', gap: '2px', padding: 'var(--space-2)' }}>
              
              {/* Timeline Ruler */}
              <div 
                className="timeline-ruler" 
                style={{ 
                  position: 'relative', 
                  overflow: 'visible', 
                  backgroundImage: 'repeating-linear-gradient(90deg, var(--border) 0px, var(--border) 1px, transparent 1px, transparent 2.5%)', 
                  backgroundSize: '100% 8px', 
                  backgroundPosition: 'bottom', 
                  backgroundRepeat: 'repeat-x', 
                  height: '26px', 
                  display: 'flex', 
                  alignItems: 'center',
                  padding: '0 var(--space-3)',
                  border: 'none',
                  background: 'transparent'
                }}
              >
                <span style={{ fontSize: 'var(--text-micro)', fontFamily: 'var(--font-mono)' }}>00:00.0</span>
                <strong style={{ margin: '0 auto', fontSize: 'var(--text-small)', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                  {formatDuration(editor.playheadMs)}
                </strong>
                <span style={{ fontSize: 'var(--text-micro)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                  {formatDuration(view.durationMs)}
                </span>

                {/* Playhead Pentagon Handle (Glowing) */}
                <div 
                  style={{
                    position: 'absolute',
                    left: `${playheadPercent}%`,
                    top: 'calc(100% - 4px)',
                    width: '11px',
                    height: '13px',
                    background: 'var(--destructive)',
                    clipPath: 'polygon(50% 100%, 0% 50%, 0% 0%, 100% 0%, 100% 50%)',
                    transform: 'translateX(-50%)',
                    cursor: 'ew-resize',
                    zIndex: 10,
                    transition: 'left 80ms ease'
                  }}
                  title="Scrub timeline playhead"
                />
              </div>

              {/* Tracks */}
              {project.timeline.tracks.map((track) => (
                <div 
                  className="timeline-track" 
                  key={track.id}
                  style={{
                    gridTemplateColumns: '120px minmax(0, 1fr)',
                    border: mutedTracks[track.id] ? '1px dashed var(--border)' : undefined,
                    borderRadius: 0,
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  {/* Custom Track Label with Mute / Solo / Lock controls */}
                  <div 
                    className="timeline-track__label"
                    style={{
                      display: 'grid',
                      gridTemplateRows: 'auto auto',
                      gap: '4px',
                      alignContent: 'center',
                      padding: 'var(--space-2)',
                      background: 'var(--surface-raised-soft)',
                      borderRight: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '11px' }}>{track.kind === 'video' ? '📹' : '🎤'}</span>
                      <strong style={{ fontSize: 'var(--text-small)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>
                        {track.name}
                      </strong>
                    </div>
                    
                    {/* Track Controller Switch Buttons */}
                    <div style={{ display: 'flex', gap: '3px', marginTop: '2px' }}>
                      <button 
                        type="button"
                        title="Mute track"
                        onClick={(e) => { e.stopPropagation(); setMutedTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '1px',
                          background: mutedTracks[track.id] ? 'var(--destructive)' : 'var(--background)',
                          color: mutedTracks[track.id] ? '#fff' : 'var(--muted-foreground)',
                          fontSize: '9px',
                          fontWeight: 'bold',
                          padding: '1px 3px',
                          cursor: 'pointer',
                          lineHeight: 1.1
                        }}
                      >
                        M
                      </button>
                      <button 
                        type="button"
                        title="Solo track"
                        onClick={(e) => { e.stopPropagation(); setSoloTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '1px',
                          background: soloTracks[track.id] ? 'var(--warning)' : 'var(--background)',
                          color: soloTracks[track.id] ? '#000' : 'var(--muted-foreground)',
                          fontSize: '9px',
                          fontWeight: 'bold',
                          padding: '1px 3px',
                          cursor: 'pointer',
                          lineHeight: 1.1
                        }}
                      >
                        S
                      </button>
                      <button 
                        type="button"
                        title="Lock track toggle"
                        onClick={(e) => { e.stopPropagation(); setLockedTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '1px',
                          background: lockedTracks[track.id] ? 'var(--primary)' : 'var(--background)',
                          color: lockedTracks[track.id] ? '#fff' : 'var(--muted-foreground)',
                          fontSize: '9px',
                          padding: '1px 3px',
                          cursor: 'pointer',
                          lineHeight: 1.1
                        }}
                      >
                        {lockedTracks[track.id] ? '🔒' : '🔓'}
                      </button>
                    </div>
                  </div>

                  {/* Track Lane */}
                  <div
                    className="timeline-track__lane"
                    onDragOver={(event) => !lockedTracks[track.id] && event.preventDefault()}
                    onDrop={(event) => !lockedTracks[track.id] && onLaneDrop(event, track.id)}
                    onPointerDown={(event) => !lockedTracks[track.id] && scrubLane(event)}
                    role="application"
                    aria-label={`${track.name} lane. Drop assets or clips here.`}
                    style={{
                      opacity: lockedTracks[track.id] ? 0.6 : 1,
                      backgroundImage: lockedTracks[track.id] 
                        ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 6px, transparent 6px, transparent 12px)'
                        : undefined,
                      cursor: lockedTracks[track.id] ? 'not-allowed' : 'default',
                      position: 'relative'
                    }}
                  >
                    {/* Render Waveform / Filmstrip graphics behind clips */}
                    {track.kind === 'audio' ? <AudioWaveformBg /> : <VideoFilmstripBg />}

                    {/* Internal Red playhead line synchronized */}
                    <div className="timeline-playhead" style={{ left: `${playheadPercent}%`, width: '1px', transition: 'left 80ms ease' }} aria-hidden="true" />
                    
                    {/* Track Clips */}
                    {(view.blocksByTrackId[track.id] ?? []).map((block) => (
                      <button
                        className={`timeline-clip timeline-clip--${block.kind}${editor.selectedClipId === block.clip.id ? ' timeline-clip--selected' : ''}`}
                        draggable={!lockedTracks[track.id]}
                        key={block.clip.id}
                        type="button"
                        onClick={() => !lockedTracks[track.id] && editor.setSelectedClipId(block.clip.id)}
                        onDragStart={(event) => {
                          if (lockedTracks[track.id]) return;
                          writeTimelineDrag(event, {
                            kind: 'clip',
                            clipId: block.clip.id,
                            offsetMs: clientXToTimelineMs({
                              clientX: event.clientX,
                              laneLeft: event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0,
                              laneWidth: event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1,
                              durationMs: view.durationMs,
                              snapMs: 100
                            }) - block.clip.timelineStartMs
                          });
                        }}
                        style={{ left: `${block.leftPercent}%`, width: `${Math.max(block.widthPercent, 2)}%` }}
                        title={`${block.assetName} starts at ${formatDuration(block.clip.timelineStartMs)}`}
                        aria-label={`${block.assetName}, ${block.kind} clip from ${formatDuration(block.clip.timelineStartMs)} for ${formatDuration(block.clip.sourceEndMs - block.clip.sourceStartMs)}`}
                      >
                        <span className="timeline-clip__handle timeline-clip__handle--left" draggable={!lockedTracks[track.id]} onDragStart={(event) => writeTimelineDrag(event, { kind: 'trim', clipId: block.clip.id, edge: 'left' })} aria-hidden="true" />
                        <strong>{block.assetName}</strong>
                        <small>{formatDuration(block.clip.sourceEndMs - block.clip.sourceStartMs)}</small>
                        <span className="timeline-clip__handle timeline-clip__handle--right" draggable={!lockedTracks[track.id]} onDragStart={(event) => writeTimelineDrag(event, { kind: 'trim', clipId: block.clip.id, edge: 'right' })} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
