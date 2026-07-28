import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactElement } from 'react';

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

const TOOL_BUTTON_STYLE = {
  width: '26px',
  height: '26px',
  border: 'none',
  borderRadius: 'var(--radius-xs)',
  background: 'transparent',
  color: 'var(--text-weak)',
  cursor: 'pointer',
  fontSize: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background var(--transition-fast), color var(--transition-fast)'
} as const satisfies CSSProperties;

const ACTIVE_TOOL_BUTTON_STYLE = {
  ...TOOL_BUTTON_STYLE,
  background: 'var(--surface-control-selected)',
  color: 'var(--color-primary)'
} as const satisfies CSSProperties;

const TRACK_TOGGLE_STYLE = {
  border: 'none',
  borderRadius: 'var(--radius-xs)',
  background: 'transparent',
  color: 'var(--text-weaker)',
  fontFamily: 'var(--font-mono)',
  fontSize: '9px',
  fontWeight: 600,
  padding: '2px 4px',
  cursor: 'pointer',
  lineHeight: 1.1,
  transition: 'background var(--transition-fast), color var(--transition-fast)'
} as const satisfies CSSProperties;

function trackToggleStyle(isOn: boolean, tone: 'danger' | 'warning' | 'primary'): CSSProperties {
  if (!isOn) return TRACK_TOGGLE_STYLE;
  const toneColor = tone === 'danger' ? 'var(--destructive)' : tone === 'warning' ? 'var(--warning)' : 'var(--primary)';
  return {
    ...TRACK_TOGGLE_STYLE,
    background: `color-mix(in srgb, ${toneColor} 15%, transparent)`,
    color: toneColor
  };
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
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  const onLaneDrop = (event: DragEvent<HTMLDivElement>, trackId: string): void => {
    if (view === null) return;
    event.preventDefault();
    setDragOverTrackId(null);
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

  // Ruler scrubbing: press to seek, drag while pressed to keep scrubbing.
  const scrubRuler = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (view === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    editor.setPlayheadMs(clientXToTimelineMs({ clientX: event.clientX, laneLeft: rect.left, laneWidth: rect.width, durationMs: view.durationMs, snapMs: 100 }));
  };

  const onRulerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRuler(event);
  };

  const onRulerPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    scrubRuler(event);
  };

  const trackMinHeight = (kind: string): string => (kind === 'video' ? '56px' : '42px');

  const clampZoom = (zoom: number): number => Math.min(5, Math.max(1, Math.round(zoom * 100) / 100));

  const zoomBy = (factor: number): void => {
    setZoomLevel((current) => clampZoom(current * factor));
  };

  // Ctrl/Cmd + wheel (or trackpad pinch) zooms around the cursor: the time under
  // the pointer stays anchored while the content width scales. Plain and shift
  // wheel keep native scrolling. Attached natively so preventDefault is honored.
  const stackRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = useRef<{ anchorX: number; scrollLeft: number; previousZoom: number } | null>(null);
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  useEffect(() => {
    const stack = stackRef.current;
    if (stack === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const zoomMultiplier = event.deltaY > 0 ? 1 / 1.1 : 1.1;
      const previousZoom = zoomLevelRef.current;
      const nextZoom = clampZoom(previousZoom * zoomMultiplier);
      if (nextZoom === previousZoom) return;
      zoomAnchorRef.current = {
        anchorX: event.clientX - stack.getBoundingClientRect().left,
        scrollLeft: stack.scrollLeft,
        previousZoom
      };
      setZoomLevel(nextZoom);
    };

    stack.addEventListener('wheel', onWheel, { passive: false });
    return () => stack.removeEventListener('wheel', onWheel);
  }, [project === null]);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    const anchor = zoomAnchorRef.current;
    if (stack === null || anchor === null) return;
    zoomAnchorRef.current = null;
    const contentX = (anchor.scrollLeft + anchor.anchorX) * (zoomLevel / anchor.previousZoom);
    stack.scrollLeft = Math.max(0, contentX - anchor.anchorX);
  }, [zoomLevel]);

  // Hand tool: drag the track area to pan the timeline horizontally.
  const panOriginRef = useRef<{ pointerX: number; scrollLeft: number } | null>(null);

  const onStackPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activeTool !== 'hand') return;
    const stack = stackRef.current;
    if (stack === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panOriginRef.current = { pointerX: event.clientX, scrollLeft: stack.scrollLeft };
  };

  const onStackPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const origin = panOriginRef.current;
    const stack = stackRef.current;
    if (origin === null || stack === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    stack.scrollLeft = origin.scrollLeft + origin.pointerX - event.clientX;
  };

  const onStackPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    panOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Razor tool: clicking a clip splits it at the clicked timeline position.
  const razorSplitClip = (event: React.MouseEvent<HTMLButtonElement>, clipId: string): void => {
    if (view === null) return;
    const lane = event.currentTarget.parentElement;
    if (lane === null) return;
    const laneRect = lane.getBoundingClientRect();
    const atMs = clientXToTimelineMs({ clientX: event.clientX, laneLeft: laneRect.left, laneWidth: laneRect.width, durationMs: view.durationMs, snapMs: 10 });
    editor.splitClipAt(clipId, atMs);
  };

  return (
    <section id={id} className="timeline-panel editor-timeline-region" aria-labelledby="timeline-title" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: 0, padding: 0 }}>
      {/* Slim timeline toolbar: title + view tools on the left, zoom cluster on the right */}
      <div
        className="panel-heading"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          minHeight: '36px',
          padding: '0 var(--space-3)',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <h2 id="timeline-title" style={{ margin: 0, fontSize: 'var(--text-small)', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
            Timeline
          </h2>
          <span aria-hidden="true" style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} role="group" aria-label="Timeline view tools">
            <button
              type="button"
              onClick={() => setActiveTool('select')}
              style={activeTool === 'select' ? ACTIVE_TOOL_BUTTON_STYLE : TOOL_BUTTON_STYLE}
              aria-pressed={activeTool === 'select'}
              title="Selection Tool (V)"
            >
              ↖
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('razor')}
              style={activeTool === 'razor' ? ACTIVE_TOOL_BUTTON_STYLE : TOOL_BUTTON_STYLE}
              aria-pressed={activeTool === 'razor'}
              title="Razor Cut Tool (C)"
            >
              ✂
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('hand')}
              style={activeTool === 'hand' ? ACTIVE_TOOL_BUTTON_STYLE : TOOL_BUTTON_STYLE}
              aria-pressed={activeTool === 'hand'}
              title="Hand Tool (H)"
            >
              ✋
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('text')}
              style={activeTool === 'text' ? { ...ACTIVE_TOOL_BUTTON_STYLE, fontWeight: 700 } : { ...TOOL_BUTTON_STYLE, fontWeight: 700 }}
              aria-pressed={activeTool === 'text'}
              title="Type Tool (T)"
            >
              T
            </button>
          </div>
        </div>

        {/* Zoom cluster: − slider + */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4)}
            style={TOOL_BUTTON_STYLE}
            aria-label="Zoom timeline out"
            title="Zoom out"
          >
            −
          </button>
          <input
            type="range"
            min="1"
            max="5"
            step="0.1"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
            style={{ width: '96px', accentColor: 'var(--primary)', cursor: 'ew-resize' }}
            aria-label="Timeline zoom level"
            title="Adjust timeline zoom level (Ctrl/Cmd + scroll on the tracks)"
          />
          <button
            type="button"
            onClick={() => zoomBy(1.4)}
            style={TOOL_BUTTON_STYLE}
            aria-label="Zoom timeline in"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {project === null || view === null ? (
        <div className="timeline-empty">Open a project to see editable local tracks.</div>
      ) : (
        <div
          className="timeline-stack"
          ref={stackRef}
          onPointerDown={onStackPointerDown}
          onPointerMove={onStackPointerMove}
          onPointerUp={onStackPointerUp}
          onPointerCancel={onStackPointerUp}
          style={{ overflowX: 'auto', position: 'relative', height: '100%', cursor: activeTool === 'hand' ? (panOriginRef.current === null ? 'grab' : 'grabbing') : undefined }}
        >
          {/* Scrollable Container based on zoomLevel */}
          <div style={{ width: `calc(100% * ${zoomLevel})`, minWidth: '100%', position: 'relative', display: 'grid', gap: '4px', padding: 'var(--space-2) var(--space-3)' }}>

            {/* Slim mono ruler. The scale cell mirrors the track grid (104px rail + lane),
                so the scrub dot, the lane playhead line, and seek mapping share the exact
                same horizontal coordinate space. */}
            <div
              className="timeline-ruler"
              style={{
                display: 'grid',
                gridTemplateColumns: '104px minmax(0, 1fr)',
                gap: 0,
                height: '20px',
                position: 'relative',
                overflow: 'visible',
                padding: 0,
                border: 'none',
                background: 'transparent'
              }}
            >
              {/* Rail cell: current playhead readout, aligned over the track labels */}
              <strong style={{ alignSelf: 'center', padding: '0 var(--space-2)', fontSize: 'var(--text-micro)', color: 'var(--text-strong)', fontFamily: 'var(--font-mono)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatDuration(editor.playheadMs)}
              </strong>

              {/* Scale cell: same width and left edge as the track lanes */}
              <div
                onPointerDown={onRulerPointerDown}
                onPointerMove={onRulerPointerMove}
                role="slider"
                aria-label="Timeline playhead position"
                aria-valuemin={0}
                aria-valuemax={view.durationMs}
                aria-valuenow={editor.playheadMs}
                aria-valuetext={`Playhead at ${formatDuration(editor.playheadMs)}`}
                tabIndex={-1}
                style={{
                  cursor: 'ew-resize',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minWidth: 0,
                  backgroundImage: 'repeating-linear-gradient(90deg, var(--border) 0px, var(--border) 1px, transparent 1px, transparent 2.5%)',
                  backgroundSize: '100% 6px',
                  backgroundPosition: 'bottom',
                  backgroundRepeat: 'repeat-x'
                }}
              >
                <span style={{ padding: '0 var(--space-2)', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-mono)', color: 'var(--text-weaker)' }}>00:00.0</span>
                <span style={{ padding: '0 var(--space-2)', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-mono)', color: 'var(--text-weaker)', textAlign: 'right' }}>
                  {formatDuration(view.durationMs)}
                </span>

                {/* Playhead scrub-dot handle — same percent space as the lane playhead line */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${playheadPercent}%`,
                    bottom: '-5px',
                    width: '11px',
                    height: '11px',
                    background: 'var(--foreground)',
                    border: '2px solid var(--card)',
                    borderRadius: '50%',
                    transform: 'translateX(-50%)',
                    cursor: 'ew-resize',
                    zIndex: 10,
                    boxShadow: 'var(--shadow-control)',
                    transition: 'left 80ms ease'
                  }}
                  title="Scrub timeline playhead"
                />
              </div>
            </div>

            {/* Tracks */}
            {project.timeline.tracks.map((track) => (
              <div
                className="timeline-track"
                key={track.id}
                style={{
                  gridTemplateColumns: '104px minmax(0, 1fr)',
                  minHeight: trackMinHeight(track.kind),
                  opacity: mutedTracks[track.id] ? 0.55 : 1
                }}
              >
                {/* Compact track rail: kind icon + name, quiet M/S/L toggles */}
                <div
                  className="timeline-track__label"
                  style={{
                    display: 'grid',
                    gridTemplateRows: 'auto auto',
                    gap: '3px',
                    alignContent: 'center',
                    padding: 'var(--space-2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span aria-hidden="true" style={{ fontSize: '10px' }}>{track.kind === 'video' ? '🎬' : '🎵'}</span>
                    <strong style={{ fontSize: 'var(--text-micro)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70px' }}>
                      {track.name}
                    </strong>
                  </div>

                  {/* Track toggle cluster */}
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button
                      type="button"
                      title="Mute track"
                      aria-pressed={Boolean(mutedTracks[track.id])}
                      onClick={(e) => { e.stopPropagation(); setMutedTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                      style={trackToggleStyle(Boolean(mutedTracks[track.id]), 'danger')}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      title="Solo track"
                      aria-pressed={Boolean(soloTracks[track.id])}
                      onClick={(e) => { e.stopPropagation(); setSoloTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                      style={trackToggleStyle(Boolean(soloTracks[track.id]), 'warning')}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      title="Lock track toggle"
                      aria-pressed={Boolean(lockedTracks[track.id])}
                      onClick={(e) => { e.stopPropagation(); setLockedTracks(prev => ({ ...prev, [track.id]: !prev[track.id] })); }}
                      style={trackToggleStyle(Boolean(lockedTracks[track.id]), 'primary')}
                    >
                      L
                    </button>
                  </div>
                </div>

                {/* Track Lane */}
                <div
                  className="timeline-track__lane"
                  onDragOver={(event) => {
                    if (lockedTracks[track.id]) return;
                    event.preventDefault();
                    setDragOverTrackId(track.id);
                  }}
                  onDragLeave={() => setDragOverTrackId((current) => (current === track.id ? null : current))}
                  onDrop={(event) => !lockedTracks[track.id] && onLaneDrop(event, track.id)}
                  onPointerDown={(event) => activeTool !== 'hand' && !lockedTracks[track.id] && scrubLane(event)}
                  role="application"
                  aria-label={`${track.name} lane. Drop assets or clips here.`}
                  style={{
                    minHeight: trackMinHeight(track.kind),
                    opacity: lockedTracks[track.id] ? 0.6 : 1,
                    outline: dragOverTrackId === track.id ? '1.5px dashed var(--ring)' : undefined,
                    outlineOffset: dragOverTrackId === track.id ? '-1.5px' : undefined,
                    background: dragOverTrackId === track.id ? 'color-mix(in srgb, var(--primary) 7%, var(--surface-inset))' : undefined,
                    backgroundImage: lockedTracks[track.id]
                      ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 6px, transparent 6px, transparent 12px)'
                      : undefined,
                    cursor: lockedTracks[track.id] ? 'not-allowed' : activeTool === 'razor' ? 'crosshair' : 'default',
                    position: 'relative'
                  }}
                >
                  {/* Playhead hairline synchronized across lanes */}
                  <div className="timeline-playhead" style={{ left: `${playheadPercent}%`, transition: 'left 80ms ease' }} aria-hidden="true" />

                  {/* Track Clips */}
                  {(view.blocksByTrackId[track.id] ?? []).map((block) => (
                    <button
                      className={`timeline-clip timeline-clip--${block.kind}${editor.selectedClipId === block.clip.id ? ' timeline-clip--selected' : ''}`}
                      draggable={!lockedTracks[track.id] && activeTool === 'select'}
                      key={block.clip.id}
                      type="button"
                      onClick={(event) => {
                        if (lockedTracks[track.id]) return;
                        if (activeTool === 'razor') {
                          razorSplitClip(event, block.clip.id);
                          return;
                        }
                        editor.setSelectedClipId(block.clip.id);
                      }}
                      onDragStart={(event) => {
                        if (lockedTracks[track.id] || activeTool !== 'select') return;
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
                      style={{ left: `${block.leftPercent}%`, width: `${Math.max(block.widthPercent, 2)}%`, cursor: activeTool === 'razor' ? 'crosshair' : undefined }}
                      title={`${block.assetName} starts at ${formatDuration(block.clip.timelineStartMs)}`}
                      aria-label={`${block.assetName}, ${block.kind} clip from ${formatDuration(block.clip.timelineStartMs)} for ${formatDuration(block.clip.sourceEndMs - block.clip.sourceStartMs)}`}
                    >
                      <span className="timeline-clip__handle timeline-clip__handle--left" draggable={!lockedTracks[track.id] && activeTool === 'select'} onDragStart={(event) => writeTimelineDrag(event, { kind: 'trim', clipId: block.clip.id, edge: 'left' })} aria-hidden="true" />
                      <strong>{block.assetName}</strong>
                      <small>{formatDuration(block.clip.sourceEndMs - block.clip.sourceStartMs)}</small>
                      <span className="timeline-clip__handle timeline-clip__handle--right" draggable={!lockedTracks[track.id] && activeTool === 'select'} onDragStart={(event) => writeTimelineDrag(event, { kind: 'trim', clipId: block.clip.id, edge: 'right' })} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
