import type { ReactElement } from 'react';

import { formatDuration } from '../format';
import type { TimelineEditorController } from './useTimelineEditor';

type TitleToolPanelProps = {
  readonly editor: TimelineEditorController;
};

export function TitleToolPanel({ editor }: TitleToolPanelProps): ReactElement {
  const title = editor.titleAtPlayhead;
  const titles = [...(editor.project?.timeline.titles ?? [])].sort((a, b) => a.timelineStartMs - b.timelineStartMs);

  return (
    <section className="title-tool-panel" aria-labelledby="title-tool-heading">
      <div className="title-tool-panel__heading">
        <h2 id="title-tool-heading">Text</h2>
        <button className="button button--primary" type="button" onClick={editor.addTitleAtPlayhead} disabled={editor.project === null}>
          Add title
        </button>
      </div>
      {editor.project === null ? (
        <div className="empty-slate">Open a project to add text to the timeline.</div>
      ) : (
        <>
          <p className="title-tool-panel__hint">Move the playhead to place or edit a title.</p>
          {title !== null && (
            <div className="title-tool-panel__current">
              <label className="field-label" htmlFor="editor-title-tool-text">Text at playhead</label>
              <input
                id="editor-title-tool-text"
                value={title.text}
                onChange={(event) => editor.editTitle(title.id, { text: event.currentTarget.value })}
              />
              <button className="button button--ghost" type="button" onClick={() => editor.deleteTitle(title.id)}>Delete title</button>
            </div>
          )}
          <div className="title-tool-panel__list" aria-label="Timeline titles">
            {titles.length === 0 ? <div className="empty-slate">No titles yet.</div> : titles.map((entry) => (
              <button
                key={entry.id}
                className={`title-tool-panel__item${title?.id === entry.id ? ' title-tool-panel__item--active' : ''}`}
                type="button"
                onClick={() => editor.setPlayheadMs(entry.timelineStartMs)}
                aria-current={title?.id === entry.id ? 'true' : undefined}
              >
                <strong>{entry.text}</strong>
                <small>{formatDuration(entry.timelineStartMs)} – {formatDuration(entry.timelineEndMs)}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
