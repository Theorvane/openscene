import { describe, expect, it } from 'vitest';

import { titlePreviewLayout, titlesAt } from '../src/shared/titlePreviewLayout';
import { DEFAULT_TITLE, type TimelineTitle } from '../src/shared/timelineTypes';

function title(overrides: Partial<TimelineTitle> = {}): TimelineTitle {
  return { ...DEFAULT_TITLE, id: 'title-1', timelineStartMs: 0, timelineEndMs: 3_000, ...overrides };
}

describe('titlePreviewLayout', () => {
  it('shrinks a title by however much the frame was shrunk', () => {
    const layout = titlePreviewLayout(title({ sizePx: 72, positionX: 100, positionY: -40 }), { width: 480, height: 270 });

    expect(layout.fontSizePx).toBe(18);
    expect(layout.offsetXPx).toBe(25);
    expect(layout.offsetYPx).toBe(-10);
  });

  it('is a no-op when the preview is the size of the export', () => {
    const layout = titlePreviewLayout(title({ sizePx: 72, positionX: 12 }), { width: 1920, height: 1080 });

    expect(layout).toEqual({ fontSizePx: 72, offsetXPx: 12, offsetYPx: 0 });
  });

  it('takes the smaller fit when the preview does not share the export aspect', () => {
    // A 16:9 export in a 1:1 pane letterboxes; the visible picture is the width
    // fit, and scaling by height would push the words outside it.
    const layout = titlePreviewLayout(title({ sizePx: 108 }), { width: 960, height: 960 });

    expect(layout.fontSizePx).toBe(54);
  });

  it('scales to nothing rather than dividing by zero before the pane is measured', () => {
    expect(titlePreviewLayout(title({ sizePx: 72 }), { width: 0, height: 0 })).toEqual({
      fontSizePx: 0,
      offsetXPx: 0,
      offsetYPx: 0
    });
  });
});

describe('titlesAt', () => {
  const first = title({ id: 'a', timelineStartMs: 0, timelineEndMs: 2_000 });
  const second = title({ id: 'b', timelineStartMs: 1_000, timelineEndMs: 4_000 });

  it('returns every title covering the moment, in document order', () => {
    expect(titlesAt([first, second], 1_500).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('treats the end as exclusive, so a title does not linger on the frame it ends', () => {
    expect(titlesAt([first, second], 2_000).map((entry) => entry.id)).toEqual(['b']);
  });

  it('reads an absent list as no titles, which is what every project made before them has', () => {
    expect(titlesAt(undefined, 0)).toEqual([]);
  });
});
