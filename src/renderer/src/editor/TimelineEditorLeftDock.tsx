import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

import { DEFAULT_MEDIA_LIBRARY_FILTERS, type MediaLibraryFilters } from '../../../shared/mediaLibraryView';
import { AssetBin } from './AssetBin';
import { EDITOR_LEFT_DOCK_TAB_IDS, getNextEditorDockTabId, type EditorLeftDockTabId } from './dockTabs';
import { ProjectRail } from './ProjectRail';
import { TitleToolPanel } from './TitleToolPanel';
import type { TimelineEditorController } from './useTimelineEditor';

type TimelineEditorLeftDockProps = {
  readonly activeTabId: EditorLeftDockTabId;
  readonly editor: TimelineEditorController;
  readonly leftDockVisible: boolean;
  readonly projectPanelFloating: boolean;
  readonly onActiveTabChange: (tabId: EditorLeftDockTabId) => void;
};

const LEFT_DOCK_STYLE = {
  display: 'grid',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

const TOOLS: Readonly<Record<EditorLeftDockTabId, { label: string; icon: ReactNode }>> = {
  project: { label: 'Project', icon: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9h16M8 5V3" /></> },
  media: { label: 'Media', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16M3 10h5M16 10h5M3 15h5M16 15h5" /></> },
  audio: { label: 'Audio', icon: <><path d="M5 9v6M9 6v12M13 3v18M17 7v10M21 10v4" /></> },
  text: { label: 'Text', icon: <><path d="M4 6V4h16v2M12 4v16M8 20h8" /></> }
};

export function TimelineEditorLeftDock({ activeTabId, editor, leftDockVisible, projectPanelFloating, onActiveTabChange }: TimelineEditorLeftDockProps): ReactElement {
  const [mediaFilters, setMediaFilters] = useState<MediaLibraryFilters>(DEFAULT_MEDIA_LIBRARY_FILTERS);
  const [audioFilters, setAudioFilters] = useState<MediaLibraryFilters>(DEFAULT_MEDIA_LIBRARY_FILTERS);
  const projectId = editor.project?.id ?? null;
  useEffect(() => {
    setMediaFilters(DEFAULT_MEDIA_LIBRARY_FILTERS);
    setAudioFilters(DEFAULT_MEDIA_LIBRARY_FILTERS);
  }, [projectId]);
  const tabs = EDITOR_LEFT_DOCK_TAB_IDS.map((id) => ({ id, label: TOOLS[id].label }));
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = getNextEditorDockTabId({ currentTabId: activeTabId, key: event.key as 'ArrowUp' | 'ArrowDown' | 'Home' | 'End', tabs }) as EditorLeftDockTabId;
    onActiveTabChange(next);
    document.getElementById(`editor-tool-tab-${next}`)?.focus();
  };

  return (
    <div className="editor-left-dock" id="editor-left-dock-panel" role="region" aria-label="Editor tools" style={LEFT_DOCK_STYLE} hidden={!leftDockVisible}>
      <div className="editor-tool-rail" role="tablist" aria-label="Editor tools" aria-orientation="vertical">
        {EDITOR_LEFT_DOCK_TAB_IDS.map((tabId) => {
          const tool = TOOLS[tabId];
          return (
            <button
              key={tabId}
              id={`editor-tool-tab-${tabId}`}
              className={`editor-tool-tab${activeTabId === tabId ? ' editor-tool-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-controls="editor-tool-panel"
              aria-selected={activeTabId === tabId}
              aria-label={tool.label}
              title={tool.label}
              tabIndex={activeTabId === tabId ? 0 : -1}
              onClick={() => onActiveTabChange(tabId)}
              onKeyDown={onTabKeyDown}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{tool.icon}</svg>
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>
      <div className="editor-tool-panel" id="editor-tool-panel" role="tabpanel" aria-labelledby={`editor-tool-tab-${activeTabId}`}>
        {activeTabId === 'project'
          ? (projectPanelFloating ? <div className="empty-slate">The project panel is floating above the editor.</div> : <ProjectRail editor={editor} />)
          : activeTabId === 'media'
            ? <AssetBin editor={editor} filters={mediaFilters} onFiltersChange={setMediaFilters} />
            : activeTabId === 'audio'
              ? <AssetBin editor={editor} filter="audio" filters={audioFilters} onFiltersChange={setAudioFilters} />
              : <TitleToolPanel editor={editor} />}
      </div>
    </div>
  );
}
