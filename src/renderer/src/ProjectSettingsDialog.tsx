import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import { formatTimestamp } from './format';
import { Button } from './ui';

type ProjectSettingsDialogProps = {
  readonly project: LocalProjectSnapshot;
  readonly summary: LocalProjectSummary | undefined;
  readonly isBusy: boolean;
  readonly onRename: (name: string) => Promise<boolean>;
  readonly onRemove: () => Promise<void>;
  readonly onClose: () => void;
};

/**
 * Settings for the open project, opened from the workspace tab line. Everything
 * here changes real behaviour: the name is stored, and removal follows the
 * store's rule — a folder the user chose is only unregistered, while a project
 * living in app storage has its files deleted.
 */
export function ProjectSettingsDialog({ project, summary, isBusy, onRename, onRemove, onClose }: ProjectSettingsDialogProps): ReactElement {
  const [name, setName] = useState(project.name);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isExternal = summary?.storage === 'external';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submitRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === project.name) return;
    await onRename(trimmed);
  };

  return (
    <div className="project-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="project-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
      >
        <header className="project-settings__header">
          <h2 id="project-settings-title">Project settings</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close project settings">✕</Button>
        </header>

        <form className="project-settings__section" onSubmit={(event) => void submitRename(event)}>
          <label className="project-settings__field">
            <span className="project-settings__label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isBusy}
              aria-label="Project name"
            />
          </label>
          <Button type="submit" variant="primary" disabled={isBusy || name.trim().length === 0 || name.trim() === project.name}>
            Rename
          </Button>
        </form>

        <dl className="project-settings__details">
          <div><dt>Storage</dt><dd>{isExternal ? 'A folder you chose' : 'App storage'}</dd></div>
          <div><dt>Created</dt><dd>{formatTimestamp(project.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{formatTimestamp(project.updatedAt)}</dd></div>
          <div><dt>Assets</dt><dd>{project.assets.length}</dd></div>
          <div><dt>Tracks</dt><dd>{project.timeline.tracks.length}</dd></div>
        </dl>

        <section className="project-settings__section project-settings__danger" aria-label="Remove project">
          <div>
            <p className="project-settings__label">{isExternal ? 'Remove from OpenVideo' : 'Delete project'}</p>
            <p className="project-settings__hint">
              {isExternal
                ? 'Takes the project out of the list. The folder and its files stay on disk.'
                : 'Deletes the project and its files from app storage. This cannot be undone.'}
            </p>
          </div>
          {confirmingRemove ? (
            <div className="project-settings__confirm">
              <Button variant="stop" disabled={isBusy} onClick={() => void onRemove()}>
                {isExternal ? 'Remove' : 'Delete'}
              </Button>
              <Button variant="ghost" disabled={isBusy} onClick={() => setConfirmingRemove(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="ghost" disabled={isBusy} onClick={() => setConfirmingRemove(true)}>
              {isExternal ? 'Remove' : 'Delete'}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
