import type { KeyboardEvent, ReactElement } from 'react';

import { APP_WORKSPACES, getNextAppWorkspaceId } from './appWorkspaces';
import type { AppWorkspaceId, AppWorkspaceNavigationKey } from './appWorkspaces';
import { Button } from './ui';
import { classNames } from './ui/classNames';

type AppWorkspaceNavigationProps = {
  readonly activeWorkspaceId: AppWorkspaceId;
  readonly onActiveWorkspaceChange: (workspaceId: AppWorkspaceId) => void;
};

const WORKSPACE_ICON_CLASS_NAME = 'workspace-nav-item__svg';

function EditorTimelineIcon(): ReactElement {
  return (
    <svg className={WORKSPACE_ICON_CLASS_NAME} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 7.5h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 16.5h15" />
      <path d="M9 5v14" />
      <path d="M13.5 9.75h3.75" />
      <path d="M6.75 14.25h5.25" />
    </svg>
  );
}

function AiVideoIcon(): ReactElement {
  return (
    <svg className={WORKSPACE_ICON_CLASS_NAME} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      <path d="M7 10l1.5 3L10 10" />
    </svg>
  );
}

function VoiceWaveformIcon(): ReactElement {
  return (
    <svg className={WORKSPACE_ICON_CLASS_NAME} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 13.25v-2.5" />
      <path d="M8.25 16.5v-9" />
      <path d="M12 18.25V5.75" />
      <path d="M15.75 16.5v-9" />
      <path d="M19.5 13.25v-2.5" />
    </svg>
  );
}

const WORKSPACE_ICONS = {
  edit: EditorTimelineIcon,
  'video-generation': AiVideoIcon,
  'voice-generation': VoiceWaveformIcon
} as const satisfies Readonly<Record<AppWorkspaceId, () => ReactElement>>;

function isAppWorkspaceNavigationKey(key: string): key is AppWorkspaceNavigationKey {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End':
      return true;
    default:
      return false;
  }
}

export function AppWorkspaceNavigation({ activeWorkspaceId, onActiveWorkspaceChange }: AppWorkspaceNavigationProps): ReactElement {
  const handleKeyDown = (workspaceId: AppWorkspaceId) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isAppWorkspaceNavigationKey(event.key)) return;

    event.preventDefault();
    onActiveWorkspaceChange(getNextAppWorkspaceId({ currentWorkspaceId: workspaceId, key: event.key }));
  };

  return (
    <nav className="workspace-nav" aria-label="Application workspaces">
      <div className="workspace-nav__header">
        <p className="section-kicker">Workspaces</p>
        <span className="workspace-nav__meta">Tool palette</span>
      </div>
      {APP_WORKSPACES.map((workspace) => {
        const isActive = workspace.id === activeWorkspaceId;
        const WorkspaceIcon = WORKSPACE_ICONS[workspace.id];

        return (
          <Button
            aria-controls={workspace.panelId}
            aria-current={isActive ? 'page' : undefined}
            className={classNames('workspace-nav-item', isActive ? 'workspace-nav-item--active' : undefined)}
            id={workspace.navId}
            key={workspace.id}
            variant={isActive ? 'primary' : 'default'}
            onClick={() => onActiveWorkspaceChange(workspace.id)}
            onKeyDown={handleKeyDown(workspace.id)}
          >
            <span className="workspace-nav-item__icon" aria-hidden="true">
              <WorkspaceIcon />
            </span>
            <span className="workspace-nav-item__text">
              <span className="workspace-nav-item__label">{workspace.label}</span>
              <span className="workspace-nav-item__status">{workspace.statusLabel}</span>
            </span>
            {isActive && <span className="workspace-nav-item__marker">Current</span>}
          </Button>
        );
      })}
    </nav>
  );
}
