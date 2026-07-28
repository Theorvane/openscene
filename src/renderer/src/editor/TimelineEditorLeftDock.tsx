import type { CSSProperties, ReactElement } from 'react';

import { AssetBin } from './AssetBin';
import type { TimelineEditorController } from './useTimelineEditor';

type TimelineEditorLeftDockProps = {
  readonly editor: TimelineEditorController;
  readonly leftDockVisible: boolean;
};

const LEFT_DOCK_STYLE = {
  gridTemplateRows: 'auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0
} as const satisfies CSSProperties;

const LEFT_DOCK_HEADING_STYLE = {
  display: 'grid',
  gap: 'var(--space-3)'
} as const satisfies CSSProperties;

const LEFT_DOCK_TITLE_STYLE = {
  fontSize: 'var(--text-subhead)',
  letterSpacing: '-0.03em',
  lineHeight: 1.12,
  margin: 0
} as const satisfies CSSProperties;

export function TimelineEditorLeftDock({ editor, leftDockVisible }: TimelineEditorLeftDockProps): ReactElement {
  return (
    <div className="editor-left-dock" id="editor-left-dock-panel" role="region" aria-labelledby="editor-left-dock-title" style={LEFT_DOCK_STYLE} hidden={!leftDockVisible}>
      <div className="panel-heading editor-left-dock__heading" style={LEFT_DOCK_HEADING_STYLE}>
        <div>
          <p className="section-kicker">Media Dock</p>
          <h2 id="editor-left-dock-title" style={LEFT_DOCK_TITLE_STYLE}>Media Bin</h2>
        </div>
      </div>
      <AssetBin editor={editor} />
    </div>
  );
}
