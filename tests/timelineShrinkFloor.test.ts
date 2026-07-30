import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  clampEditorProgramPercent
} from '../src/renderer/src/editor/editorPanelLayout';

const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');

describe('timeline shrink floor', () => {
  it('gives the timeline row a pixel minimum, not just a percentage one', () => {
    // Measured before the fix: at a 542px workspace and 85% program, the row was
    // 100px and the track area 52px — less than one 56px video track, so all
    // that stayed on screen was the toolbar and the panel appeared to fold into
    // its own header.
    expect(css).toContain('minmax(var(--editor-timeline-min-height, 150px), var(--editor-timeline-percent, 42fr))');
    expect(css).not.toContain('minmax(0, var(--editor-timeline-percent, 42fr))');
  });

  it('keeps the program row free to shrink so the floor can be honoured', () => {
    // With both rows floored the grid would overflow instead of yielding.
    expect(css).toContain('minmax(0, var(--editor-program-percent, 58fr))');
  });

  it('leaves the percentage clamp in place as the coarse limit', () => {
    // The percentage bounds still stop the drag; the pixel floor is what a short
    // window needs, because 25% of a short workspace is not a usable timeline.
    expect(EDITOR_LAYOUT_MIN_PROGRAM_PERCENT).toBe(25);
    expect(EDITOR_LAYOUT_MAX_PROGRAM_PERCENT).toBe(75);
    expect(clampEditorProgramPercent(140)).toBe(75);
    expect(clampEditorProgramPercent(-20)).toBe(25);
  });
});
