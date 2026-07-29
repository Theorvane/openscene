import type { CSSProperties, ReactElement } from 'react';

import { AgentChatPanel } from './AgentChatPanel';
import { NarrationPanel } from './NarrationPanel';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import { RIGHT_PANEL_TAB_IDS, type RightPanelTabId } from './rightPanelTabs';
import { Button, Tabs, type TabDefinition } from './ui';

type WorkspaceSidePanelProps = {
  readonly width: number;
  readonly tabId: RightPanelTabId;
  readonly onTabChange: (tabId: RightPanelTabId) => void;
  readonly onCollapse: () => void;
};

type WorkspaceSidePanelStyle = CSSProperties & {
  readonly '--agent-chat-panel-width': string;
};

const TAB_LABELS: Readonly<Record<RightPanelTabId, string>> = {
  chat: 'Chat',
  voice: 'Voice',
  video: 'Video'
};

const TABS: readonly TabDefinition<RightPanelTabId>[] = RIGHT_PANEL_TAB_IDS.map((id) => ({ id, label: TAB_LABELS[id] }));

/**
 * The workspace side panel: one panel, three surfaces. A tab strip in the top
 * bar switches between the Edit Agent chat and the voice and video generation
 * studios, so generating a clip and placing it on the timeline never changes
 * screens and the studios cost no extra screen edge.
 */
export function WorkspaceSidePanel({ width, tabId, onTabChange, onCollapse }: WorkspaceSidePanelProps): ReactElement {
  const panelStyle: WorkspaceSidePanelStyle = { '--agent-chat-panel-width': `${width}px` };

  return (
    <aside
      id="app-shell-agent-chat"
      className="agent-chat-panel-shell"
      aria-label="OpenVideo workspace side panel"
      style={panelStyle}
    >
      <div className="side-panel">
        <div className="side-panel__topbar">
          <Tabs
            activeTabId={tabId}
            idBase="workspace-side-panel"
            tabs={TABS}
            onActiveTabChange={onTabChange}
            className="side-panel__tabs"
            aria-label="Side panel sections"
          />
          <Button
            variant="ghost"
            onClick={onCollapse}
            title="Collapse side panel"
            aria-label="Collapse workspace side panel"
            aria-controls="app-shell-agent-chat"
            aria-expanded={true}
          >
            ⇥
          </Button>
        </div>

        <div className="side-panel__content">
          {tabId === 'chat' && <AgentChatPanel />}
          {tabId === 'voice' && <NarrationPanel />}
          {tabId === 'video' && <VideoGenerationWorkspace />}
        </div>
      </div>
    </aside>
  );
}
