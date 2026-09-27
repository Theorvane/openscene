import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

import { EditorToolRail } from '../../../../external/opencut/apps/web/src/components/editor/editor-tool-rail';
import { DEFAULT_MEDIA_LIBRARY_FILTERS, type MediaLibraryFilters } from '../../../shared/mediaLibraryView';
import { AssetBin } from './AssetBin';
import type { EditorLeftDockTabId } from './dockTabs';
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

const LEFT_DOCK_STYLE = { display: 'grid', height: '100%', minHeight: 0, overflow: 'hidden' } as const satisfies CSSProperties;

export function TimelineEditorLeftDock({ activeTabId, editor, leftDockVisible, projectPanelFloating, onActiveTabChange }: TimelineEditorLeftDockProps): ReactElement {
  const [mediaFilters, setMediaFilters] = useState<MediaLibraryFilters>(DEFAULT_MEDIA_LIBRARY_FILTERS);
  const [audioFilters, setAudioFilters] = useState<MediaLibraryFilters>(DEFAULT_MEDIA_LIBRARY_FILTERS);
  const projectId = editor.project?.id ?? null;
  useEffect(() => {
    setMediaFilters(DEFAULT_MEDIA_LIBRARY_FILTERS);
    setAudioFilters(DEFAULT_MEDIA_LIBRARY_FILTERS);
  }, [projectId]);

  return <div className="editor-left-dock" id="editor-left-dock-panel" role="region" aria-label="Editor tools" style={LEFT_DOCK_STYLE} hidden={!leftDockVisible}>
    <EditorToolRail activeTabId={activeTabId} onActiveTabChange={onActiveTabChange} />
    <div className="editor-tool-panel" id="editor-tool-panel" role="tabpanel" aria-labelledby={`editor-tool-tab-${activeTabId}`}>
      {activeTabId === 'project'
        ? (projectPanelFloating ? <div className="empty-slate">The project panel is floating above the editor.</div> : <ProjectRail editor={editor} />)
        : activeTabId === 'media'
          ? <AssetBin editor={editor} filters={mediaFilters} onFiltersChange={setMediaFilters} />
          : activeTabId === 'audio'
            ? <AssetBin editor={editor} filter="audio" filters={audioFilters} onFiltersChange={setAudioFilters} />
            : <TitleToolPanel editor={editor} />}
    </div>
  </div>;
}
