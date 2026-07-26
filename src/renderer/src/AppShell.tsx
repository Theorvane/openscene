import type { ReactElement, ReactNode } from 'react';

import type { AppWorkspace } from './appWorkspaces';
import { AgentChatPanel } from './AgentChatPanel';
import { AgentChatProvider, useAgentChat } from './AgentChatContext';
import { LlmModelSelectorBar } from './LlmModelSelectorBar';
import { ThemeSelector } from './ThemeSelector';

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
  readonly activeWorkspace: AppWorkspace;
  readonly children: ReactNode;
};

function AppShellContent({ activeWorkspace, children }: AppShellProps): ReactElement {
  const { isBusy } = useAgentChat();

  return (
    <main className="app-shell">
      <AppShellBackground />
      <div className="app-shell__body">
        <div className="agent-workspace-lock" aria-busy={isBusy} inert={isBusy}>
          <header className="product-chrome" aria-label="Application chrome">
            <div className="product-chrome__context" aria-label="Current workspace">
              <span className="product-chrome__workspace">{activeWorkspace.label}</span>
              <span className="local-pill">Local</span>
            </div>
            <div className="product-chrome__actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LlmModelSelectorBar />
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
        <AgentChatPanel />
      </div>
    </main>
  );
}

export function AppShell({ activeWorkspace, children }: AppShellProps): ReactElement {
  return (
    <AgentChatProvider>
      <AppShellContent activeWorkspace={activeWorkspace}>{children}</AppShellContent>
    </AgentChatProvider>
  );
}
