import type { CSSProperties, ReactElement } from 'react';

import { NarrationPanel } from './NarrationPanel';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import type { StudioPanelTabId } from './studioPanelPreferences';
import { Button, TabPanel, Tabs, type TabDefinition } from './ui';

type StudioPanelProps = {
  readonly width: number;
  readonly tabId: StudioPanelTabId;
  readonly onTabChange: (tabId: StudioPanelTabId) => void;
  readonly onCollapse: () => void;
};

type StudioPanelStyle = CSSProperties & {
  readonly '--studio-panel-width': string;
};

const STUDIO_TABS: readonly TabDefinition<StudioPanelTabId>[] = [
  { id: 'voice', label: 'Voice' },
  { id: 'video', label: 'Video' }
];

/**
 * Generation studios as their own side panel, opposite the Edit Agent chat:
 * collapsible to a rail, resizable, and persistent across pages of the editor.
 * Generating a clip and placing it on the timeline never changes screens.
 */
export function StudioPanel({ width, tabId, onTabChange, onCollapse }: StudioPanelProps): ReactElement {
  const panelStyle: StudioPanelStyle = { '--studio-panel-width': `${width}px` };

  return (
    <aside id="app-shell-studio" className="studio-panel-shell" aria-label="Generation studio" style={panelStyle}>
      <div className="studio-panel">
        <div className="studio-panel__header">
          <div className="studio-panel__title">
            <p className="studio-panel__title-label">Studio</p>
            <span className="studio-panel__title-meta">Voice and video generation</span>
          </div>
          <Button
            variant="ghost"
            onClick={onCollapse}
            title="Collapse studio"
            aria-label="Collapse generation studio sidebar"
            aria-controls="app-shell-studio"
            aria-expanded={true}
          >
            ⇤
          </Button>
        </div>

        <Tabs
          activeTabId={tabId}
          idBase="studio-panel"
          tabs={STUDIO_TABS}
          onActiveTabChange={onTabChange}
          className="studio-panel__tabs"
          aria-label="Studio sections"
        />

        <div className="studio-panel__content">
          <TabPanel activeTabId={tabId} idBase="studio-panel" tabId="voice">
            <NarrationPanel />
          </TabPanel>

          <TabPanel activeTabId={tabId} idBase="studio-panel" tabId="video">
            <VideoGenerationWorkspace />
          </TabPanel>
        </div>
      </div>
    </aside>
  );
}
