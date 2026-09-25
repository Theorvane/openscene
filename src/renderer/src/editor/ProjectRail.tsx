import type { CSSProperties, ChangeEvent, ReactElement } from 'react';

import { formatTimestamp } from '../format';
import { ProjectCover } from '../ProjectCover';
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
