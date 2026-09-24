import { useEffect, useState, type CSSProperties, type ChangeEvent, type ReactElement } from 'react';

import { formatTimestamp } from '../format';
import type { TimelineEditorController } from './useTimelineEditor';

type ProjectRailProps = {
  readonly editor: TimelineEditorController;
};

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


function ProjectCover({ projectId, updatedAt }: { readonly projectId: string; readonly updatedAt: string }): ReactElement {
  const [cover, setCover] = useState<{ readonly url: string | null; readonly label: string }>({ url: null, label: 'LOADING LOCAL COVER' });
  useEffect(() => {
    let live = true;
    setCover({ url: null, label: 'LOADING LOCAL COVER' });
    // Project lookup only reads the local snapshot. It does not switch the editor's open project.
    void window.videoTool.openProject({ projectId }).then(async (result) => {
      if (!live) return;
      if (!result.ok) { setCover({ url: null, label: 'COVER UNAVAILABLE' }); return; }
      const image = result.value.assets.find((asset) => asset.kind === 'image');
      if (!image) { setCover({ url: null, label: 'NO IMAGE COVER' }); return; }
      const playback = await window.videoTool.getAssetPlaybackUrl({ projectId, assetId: image.id });
      if (live) setCover(playback.ok ? { url: playback.value.url, label: `${result.value.assets.length} LOCAL MEDIA ASSETS` } : { url: null, label: 'COVER UNAVAILABLE' });
    }).catch(() => { if (live) setCover({ url: null, label: 'COVER UNAVAILABLE' }); });
    return () => { live = false; };
  }, [projectId, updatedAt]);
  return <span className="project-card__cover">{cover.url && <img src={cover.url} alt="" onError={() => setCover({ url: null, label: 'COVER UNAVAILABLE' })} />}
    <span>{cover.label}</span>
  </span>;
}

export function ProjectRail({ editor }: ProjectRailProps): ReactElement {
  const onNameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    editor.setNewProjectName(event.target.value);
  };

  return (
    <aside className="project-rail" aria-labelledby="projects-title" style={COMPACT_PANEL_STYLE}>
      <div className="panel-heading" style={COMPACT_PANEL_HEADING_STYLE}>
        <div>
          <p className="section-kicker">Projects</p>
          <h2 id="projects-title" style={COMPACT_PANEL_TITLE_STYLE}>Local cuts</h2>
        </div>
        <button className="button button--ghost" type="button" onClick={() => void editor.refreshProjects()} disabled={editor.isBusy}>Refresh</button>
      </div>

      <label className="field-label">
        New project name
        <input value={editor.newProjectName} onChange={onNameChange} placeholder="Launch reel" />
      </label>
      <button className="button button--primary" type="button" onClick={() => void editor.createProject()} disabled={editor.isBusy}>Create project</button>

      <div className="project-list" aria-label="Saved local projects">
        {editor.projects.map((project) => (
          <button
            className={`project-card${editor.project?.id === project.id ? ' project-card--selected' : ''}`}
            key={project.id}
            type="button"
            onClick={() => void editor.openProject(project.id)}
            disabled={editor.isBusy}
          >
            <ProjectCover projectId={project.id} updatedAt={project.updatedAt} />
            <span className="project-card__info"><strong>{project.name}</strong><small>{editor.project?.id === project.id ? 'OPEN · ' : ''}{formatTimestamp(project.updatedAt)}</small></span>
          </button>
        ))}
      </div>

      {editor.project !== null && (
        <div className="runtime-card" role="status">
          Editing <strong>{editor.project.name}</strong>{editor.hasUnsavedTimeline ? ' with unsaved timeline changes.' : '.'}
        </div>
      )}
    </aside>
  );
}
