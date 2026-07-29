import { useState, type ReactElement, type ReactNode } from 'react';

import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS } from '../../../shared/timelineTypes';
import { formatDuration, formatTimestamp } from '../format';
import { Button, MetadataList, PanelHeading, TabPanel, Tabs } from '../ui';
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

type PropertyGroupProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
};

/* Collapsible property group: hairline separators, xs medium title, −/+ toggle. */
function PropertyGroup({ title, children, defaultExpanded = true }: PropertyGroupProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="property-group">
      <button
        className="property-group__header"
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        <span className={`property-group__title${isExpanded ? ' property-group__title--expanded' : ''}`}>{title}</span>
        <span aria-hidden="true" className="property-group__toggle">{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && <div className="property-group__body">{children}</div>}
    </div>
  );
}

type PropertyRowProps = {
  readonly label: string;
  readonly children: ReactNode;
};

/* Label/value property row: muted caption label left, value right. */
function PropertyRow({ label, children }: PropertyRowProps): ReactElement {
  return (
    <div className="property-row">
      <span className="property-row__label">{label}</span>
      <div className="property-row__value">{children}</div>
    </div>
  );
}

function SelectionInspector({ editor }: InspectorContentProps): ReactElement {
  const clip = editor.selectedClip;
  const effects = clip?.clip.effects ?? DEFAULT_CLIP_EFFECTS;
  const opacityPercent = effectUnitToPercent(effects.opacity);
  const scalePercent = effectUnitToPercent(effects.scale);
  const volumeDb = effectVolumeToDb(effects.volume);

  return (
    <section className="clip-controls inspector-section" aria-label="Selected clip controls">
      <h3 className="inspector-section__title">
        {clip === null ? 'No clip selected' : clip.asset?.displayName ?? 'Missing asset'}
      </h3>

      {editor.project === null ? (
        <div className="empty-slate">Create or open a project before editing clips.</div>
      ) : clip === null ? (
        <div className="empty-slate">Select a timeline clip to nudge, trim, split, or delete it.</div>
      ) : (
        <>
          <div className="inspector-action-grid" role="toolbar" aria-label="Selected clip trim controls">
            <Button className="inspector-action" onClick={() => editor.moveSelectedClip(-500)}>Nudge -0.5s</Button>
            <Button className="inspector-action" onClick={() => editor.moveSelectedClip(500)}>Nudge +0.5s</Button>
            <Button className="inspector-action" onClick={() => editor.trimSelectedClip('left', 500)}>Trim left</Button>
            <Button className="inspector-action" onClick={() => editor.trimSelectedClip('right', -500)}>Trim right</Button>
            <Button className="inspector-action" onClick={editor.splitSelectedClip}>Split middle</Button>
            <Button className="inspector-action" variant="stop" onClick={editor.deleteSelectedClip}>Delete clip</Button>
          </div>

          <PropertyGroup title="Timing">
            <MetadataList
              className="editor-meta"
              items={[
                { term: 'Track', description: clip.track.name },
                { term: 'Start', description: formatDuration(clip.clip.timelineStartMs) },
                { term: 'Source in', description: formatDuration(clip.clip.sourceStartMs) },
                { term: 'Source out', description: formatDuration(clip.clip.sourceEndMs) }
              ]}
            />
          </PropertyGroup>

          <PropertyGroup title="Transform">
            <PropertyRow label="Position">
              <span className="property-axis-label" aria-hidden="true">X</span>
              <input
                className="property-number-input"
                type="number"
                aria-label="Clip effect position X"
                value={effects.positionX}
                min={CLIP_EFFECT_RANGES.positionX.min}
                max={CLIP_EFFECT_RANGES.positionX.max}
                onChange={(event) => editor.updateSelectedClipEffects({ positionX: Number(event.currentTarget.value) })}
              />
              <span className="property-axis-label" aria-hidden="true">Y</span>
              <input
                className="property-number-input"
                type="number"
                aria-label="Clip effect position Y"
                value={effects.positionY}
                min={CLIP_EFFECT_RANGES.positionY.min}
                max={CLIP_EFFECT_RANGES.positionY.max}
                onChange={(event) => editor.updateSelectedClipEffects({ positionY: Number(event.currentTarget.value) })}
              />
            </PropertyRow>
            <PropertyRow label="Scale">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect scale"
                min={CLIP_EFFECT_RANGES.scale.min * 100}
                max={CLIP_EFFECT_RANGES.scale.max * 100}
                value={scalePercent}
                onChange={(event) => editor.updateSelectedClipEffects({ scale: effectPercentToScale(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{scalePercent}%</span>
            </PropertyRow>
            <PropertyRow label="Rotation">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect rotation"
                min="0"
                max="360"
                value={effects.rotation}
                onChange={(event) => editor.updateSelectedClipEffects({ rotation: Number(event.currentTarget.value) })}
              />
              <span className="property-dial" aria-hidden="true" title="Rotation Angle Indicator">
                <span className="property-dial__needle" style={{ transform: `translate(-50%, -100%) rotate(${effects.rotation}deg)` }} />
              </span>
              <span className="property-value-chip">{effects.rotation}°</span>
            </PropertyRow>
          </PropertyGroup>

          <PropertyGroup title="Opacity">
            <PropertyRow label="Opacity">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect opacity"
                min={CLIP_EFFECT_RANGES.opacity.min * 100}
                max={CLIP_EFFECT_RANGES.opacity.max * 100}
                value={opacityPercent}
                onChange={(event) => editor.updateSelectedClipEffects({ opacity: effectPercentToOpacity(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{opacityPercent}%</span>
            </PropertyRow>
          </PropertyGroup>

          <PropertyGroup title="Audio">
            <PropertyRow label="Volume">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect volume"
                min={CLIP_EFFECT_RANGES.volumeDb.min}
                max={CLIP_EFFECT_RANGES.volumeDb.max}
                value={volumeDb}
                onChange={(event) => editor.updateSelectedClipEffects({ volume: effectDbToVolume(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{volumeDb} dB</span>
            </PropertyRow>
          </PropertyGroup>
        </>
      )}

      {editor.activePlaybackClip !== null && (
        <PropertyGroup title="Playback">
          <PropertyRow label="Playhead"><span className="property-value-chip">{formatDuration(editor.playheadMs)}</span></PropertyRow>
          <PropertyRow label="Source time"><span className="property-value-chip">{formatDuration(editor.activePlaybackClip.sourceTimeMs)}</span></PropertyRow>
        </PropertyGroup>
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
    <section className="clip-controls inspector-section" aria-label="Selected asset metadata">
      <h3 className="inspector-section__title">{asset.displayName}</h3>
      <PropertyGroup title="Details">
        <PropertyRow label="Imported"><span className="property-value-chip">{formatTimestamp(asset.createdAt)}</span></PropertyRow>
        <PropertyRow label="Kind"><span className="property-value-chip property-value-chip--capitalize">{asset.kind}</span></PropertyRow>
        <PropertyRow label="Duration">
          <span className="property-value-chip">{asset.metadata === null ? 'Pending' : formatDuration(asset.metadata.durationMs)}</span>
        </PropertyRow>
      </PropertyGroup>
    </section>
  );
}

function ProjectInspector({ editor }: InspectorContentProps): ReactElement {
  const project = editor.project;

  if (project === null) {
    return <div className="empty-slate">Create or open a project to see project controls.</div>;
  }

  return (
    <section className="clip-controls inspector-section" aria-label="Current project controls">
      <h3 className="inspector-section__title">{project.name}</h3>
      <PropertyGroup title="Details">
        <PropertyRow label="Created"><span className="property-value-chip">{formatTimestamp(project.createdAt)}</span></PropertyRow>
        <PropertyRow label="Updated"><span className="property-value-chip">{formatTimestamp(project.updatedAt)}</span></PropertyRow>
        <PropertyRow label="Assets"><span className="property-value-chip">{project.assets.length}</span></PropertyRow>
        <PropertyRow label="Tracks"><span className="property-value-chip">{project.timeline.tracks.length}</span></PropertyRow>
      </PropertyGroup>
      <Button className="inspector-danger-action" variant="ghost" onClick={() => void editor.deleteCurrentProject()} disabled={editor.isBusy}>
        Delete project
      </Button>
    </section>
  );
}

export function InspectorPanel({ activeTabId, editor, onActiveTabChange, tabs }: InspectorPanelProps): ReactElement {
  return (
    <aside className="inspector-panel" aria-labelledby="inspector-title">
      <PanelHeading>
        <h2 id="inspector-title" className="inspector-panel__title">Inspector</h2>
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
    </aside>
  );
}
