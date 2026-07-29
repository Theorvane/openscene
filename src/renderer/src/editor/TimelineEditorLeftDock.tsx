import { useEffect, type CSSProperties, type ReactElement } from 'react';

import { NarrationPanel } from '../NarrationPanel';
import { VideoGenerationWorkspace } from '../VideoGenerationWorkspace';
import { TabPanel, Tabs, type TabDefinition } from '../ui';
import { AssetBin } from './AssetBin';
import { getDefaultEditorDockTabs, type EditorLeftDockTabId } from './dockTabs';
import type { TimelineEditorController } from './useTimelineEditor';

type TimelineEditorLeftDockProps = {
  readonly editor: TimelineEditorController;
  readonly leftDockVisible: boolean;
  readonly tabId: EditorLeftDockTabId;
  readonly onTabChange: (tabId: EditorLeftDockTabId) => void;
};

const LEFT_DOCK_STYLE = {
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

/**
 * Media bin plus the generation studios. Voice and video generation live in
 * this dock rather than on pages of their own, so producing a clip and placing
 * it on the timeline never leaves the editor. Both import their result into the
 * open project, so their tabs stay disabled until there is one.
 */
export function TimelineEditorLeftDock({ editor, leftDockVisible, tabId, onTabChange }: TimelineEditorLeftDockProps): ReactElement {
  const tabs = getDefaultEditorDockTabs(editor.project).left as readonly TabDefinition<EditorLeftDockTabId>[];
  const activeIsDisabled = tabs.find((tab) => tab.id === tabId)?.disabled === true;

  useEffect(() => {
    // Losing the project disables the studios; fall back to the bin rather than
    // leaving an empty panel behind a disabled tab.
    if (activeIsDisabled) onTabChange('media');
  }, [activeIsDisabled, onTabChange]);

  return (
    <div
      className="editor-left-dock"
      id="editor-left-dock-panel"
      role="region"
      aria-label="Media and generation dock"
      style={LEFT_DOCK_STYLE}
      hidden={!leftDockVisible}
    >
      <Tabs
        activeTabId={tabId}
        idBase="editor-left-dock"
        tabs={tabs}
        onActiveTabChange={onTabChange}
        className="editor-left-dock__tabs"
        aria-label="Media and generation sections"
      />

      <div className="editor-left-dock__content">
        <TabPanel activeTabId={tabId} idBase="editor-left-dock" tabId="media">
          <AssetBin editor={editor} />
        </TabPanel>

        <TabPanel activeTabId={tabId} idBase="editor-left-dock" tabId="voice">
          <NarrationPanel />
        </TabPanel>

        <TabPanel activeTabId={tabId} idBase="editor-left-dock" tabId="video">
          <VideoGenerationWorkspace />
        </TabPanel>
      </div>
    </div>
  );
}
