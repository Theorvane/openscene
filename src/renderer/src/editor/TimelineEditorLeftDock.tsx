import type { CSSProperties, ReactElement } from 'react';

import { AssetBin } from './AssetBin';
import type { TimelineEditorController } from './useTimelineEditor';

type TimelineEditorLeftDockProps = {
  readonly editor: TimelineEditorController;
  readonly leftDockVisible: boolean;
};

const LEFT_DOCK_STYLE = {
  display: 'grid',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

export function TimelineEditorLeftDock({ editor, leftDockVisible }: TimelineEditorLeftDockProps): ReactElement {
  return (
    <div className="editor-left-dock" id="editor-left-dock-panel" role="region" aria-label="Media dock" style={LEFT_DOCK_STYLE} hidden={!leftDockVisible}>
      <AssetBin editor={editor} />
    </div>
  );
}
