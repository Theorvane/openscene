import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
describe('timeline manipulation integration', () => {
  it('uses the same snapping function on desktop and mobile', () => {
    for (const path of ['src/renderer/src/editor/TimelineCanvas.tsx', 'mobile/src/screens/EditScreen.tsx']) {
      const source = read(path);
      expect(source).toContain('snapTimelinePosition(');
      expect(source).toContain('movingDurationMs: clipDurationMs(clip)');
      expect(source).toContain('excludeClipId: clip.id');
    }
  });
  it('keeps trim drag data from being overwritten by the parent clip', () => {
    const source = read('src/renderer/src/editor/TimelineCanvas.tsx');
    const writer = source.slice(source.indexOf('function writeTimelineDrag'), source.indexOf('const TOOL_BUTTON_STYLE'));
    expect(writer).toContain('event.stopPropagation()');
    expect(source).not.toContain('snapMs: 100');
    expect(source).toContain('snappingEnabled && !event.altKey');
  });
});
