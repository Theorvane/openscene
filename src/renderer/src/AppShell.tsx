import type { ReactElement, ReactNode } from 'react';
import type { AppWorkspace } from './appWorkspaces';
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
    <main className="app-shell">
      <AppShellBackground />
      <header className="product-chrome" aria-label="Application chrome">
        <div className="product-chrome__context" aria-label="Current workspace">
          <span className="product-chrome__workspace">{activeWorkspace.label}</span>
          <span className="local-pill">Local</span>
        </div>
        <div className="product-chrome__actions">
          <ThemeSelector />
        </div>
      </header>
      {children}
    </main>
  );
}
