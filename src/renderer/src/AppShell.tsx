import type { ReactElement, ReactNode } from 'react';
import type { AppWorkspace } from './appWorkspaces';
import { AgentChatPanel } from './AgentChatPanel';
import { AgentChatProvider } from './AgentChatContext';
import { AgentChatToggleButton } from './AgentChatToggleButton';
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

export function AppShell({ activeWorkspace, children }: AppShellProps): ReactElement {
  return (
    <AgentChatProvider>
      <main className="app-shell">
        <AppShellBackground />
        <header className="product-chrome" aria-label="Application chrome">
          <div className="product-chrome__context" aria-label="Current workspace">
            <span className="product-chrome__workspace">{activeWorkspace.label}</span>
            <span className="local-pill">Local</span>
          </div>
          <div className="product-chrome__actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AgentChatToggleButton />
            <LlmModelSelectorBar />
            <ThemeSelector />
          </div>
        </header>
        <div style={{ display: 'flex', minHeight: 0, gap: 'var(--space-2)' }}>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'grid' }}>{children}</div>
          <AgentChatPanel />
        </div>
      </main>
    </AgentChatProvider>
  );
}
