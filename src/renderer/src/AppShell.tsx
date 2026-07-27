import type { ReactElement, ReactNode } from 'react';

import type { EditAgentContextAsset } from '../../shared/editAgentContext';
import type { AppPage, AppPageId } from './appPages';
import { AgentChatPanel } from './AgentChatPanel';
import { AgentChatProvider, useAgentChat } from './AgentChatContext';
import { ThemeSelector } from './ThemeSelector';
import { Button } from './ui';

function AppShellBackground(): ReactElement {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere__beam atmosphere__beam--left" />
      <div className="atmosphere__beam atmosphere__beam--right" />
      <div className="atmosphere__grain" />
    </div>
  );
}

type AppShellProps = {
  readonly activePage: AppPage;
  readonly children: ReactNode;
  readonly onPageChange: (pageId: AppPageId) => void;
  readonly selectedContextAsset: EditAgentContextAsset | null;
};

function SettingsIcon(): ReactElement {
  return (
    <svg className="product-chrome__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M18.5 14.5l1.25 1.1-1.8 3.1-1.6-.55a7.4 7.4 0 01-1.45.85L14.6 20.7H9.4L9.1 19a7.4 7.4 0 01-1.45-.85l-1.6.55-1.8-3.1 1.25-1.1a7.2 7.2 0 010-1.7l-1.25-1.1 1.8-3.1 1.6.55c.45-.33.93-.61 1.45-.85l.3-1.7h5.2l.3 1.7c.52.24 1 .52 1.45.85l1.6-.55 1.8 3.1-1.25 1.1c.08.56.08 1.14 0 1.7z" />
    </svg>
  );
}

function HomeIcon(): ReactElement {
  return (
    <svg className="product-chrome__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 11.5L12 5l7.5 6.5" />
      <path d="M6.75 10.25V19h10.5v-8.75" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}

function AppShellContent({ activePage, children, onPageChange, selectedContextAsset }: AppShellProps): ReactElement {
  const { isBusy } = useAgentChat();
  const homeIsActive = activePage.id === 'home';
  const settingsIsActive = activePage.id === 'settings';

  return (
    <main className="app-shell">
      <AppShellBackground />
      <div className="app-shell__body">
        <div className="agent-workspace-lock" aria-busy={isBusy} inert={isBusy}>
          <header className="product-chrome" aria-label="Application chrome">
            <div className="product-chrome__context" aria-label="Current page">
              <span className="product-chrome__workspace">{activePage.chromeLabel}</span>
              <span className="local-pill">Local</span>
            </div>
            <div className="product-chrome__actions">
              <Button
                aria-controls="app-page-panel-home"
                aria-current={homeIsActive ? 'page' : undefined}
                className="product-chrome__nav-button"
                onClick={() => onPageChange('home')}
                variant={homeIsActive ? 'primary' : 'ghost'}
              >
                <HomeIcon />
                Home
              </Button>
              <Button
                aria-controls="app-page-panel-settings"
                aria-current={settingsIsActive ? 'page' : undefined}
                className="product-chrome__nav-button"
                onClick={() => onPageChange('settings')}
                variant={settingsIsActive ? 'primary' : 'ghost'}
              >
                <SettingsIcon />
                Settings
              </Button>
              <ThemeSelector />
            </div>
          </header>
          <div className="agent-workspace-lock__content">{children}</div>
          {isBusy && (
            <div className="agent-workspace-lock__message" aria-hidden="true">
              Agent is working in this project. Workspace controls are temporarily locked.
            </div>
          )}
        </div>
        {isBusy && (
          <div className="agent-workspace-lock__announcement" role="status" aria-live="polite">
            Agent is working in this project. Workspace controls are temporarily locked.
          </div>
        )}
        <AgentChatPanel selectedContextAsset={selectedContextAsset} />
      </div>
    </main>
  );
}

export function AppShell({ activePage, children, onPageChange, selectedContextAsset }: AppShellProps): ReactElement {
  return (
    <AgentChatProvider>
      <AppShellContent activePage={activePage} onPageChange={onPageChange} selectedContextAsset={selectedContextAsset}>{children}</AppShellContent>
    </AgentChatProvider>
  );
}
