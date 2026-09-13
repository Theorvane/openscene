import { describe, expect, it } from 'vitest';

import {
  applyCaptionPreset,
  applyTitleAppearanceToAutomaticCaptions,
  parseTimelineTitleStyle,
  resolvedTitleStyle,
  titleOutputPosition
} from '../src/shared/captionStyle';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import type { TimelineTitle } from '../src/shared/timelineTypes';

const base: TimelineTitle = {
  id: 'auto-caption-1', text: 'Keep these words', timelineStartMs: 1_000, timelineEndMs: 2_000,
  sizePx: 64, color: '#ffffff', positionX: 12, positionY: -8
};

describe('caption style contract', () => {
  it('materializes presets without changing identity, words or timing', () => {
    const styled = applyCaptionPreset(base, 'boxed');
    expect(styled).toMatchObject({
      id: base.id, text: base.text, timelineStartMs: base.timelineStartMs, timelineEndMs: base.timelineEndMs,
      sizePx: 60, color: '#ffffff', positionX: 0, positionY: 0,
      style: { fontWeight: 'bold', backgroundOpacity: 0.72, paddingPx: 16, placement: 'bottom' }
    });
    expect(base.style).toBeUndefined();
  });

  it('copies appearance to automatic captions only and can restore the legacy style', () => {
    const source = applyCaptionPreset({ ...base, id: 'manual-source' }, 'social');
    const manual = { ...base, id: 'manual-title', text: 'Manual' };
    const second = { ...base, id: 'transcript-caption-2', text: 'Different words', timelineStartMs: 3_000, timelineEndMs: 4_000 };
    const timeline = { ...createInitialTimeline(), titles: [manual, source, base, second] };
    const styled = applyTitleAppearanceToAutomaticCaptions(timeline, source.id);
    expect(styled?.titles?.find((title) => title.id === 'manual-title')).toBe(manual);
    expect(styled?.titles?.filter((title) => title.id.startsWith('auto-') || title.id.startsWith('transcript-')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: base.id, text: base.text, timelineStartMs: base.timelineStartMs, style: source.style }),
        expect.objectContaining({ id: second.id, text: second.text, timelineStartMs: second.timelineStartMs, style: source.style })
      ]));

    const legacy = applyTitleAppearanceToAutomaticCaptions(styled!, manual.id);
    expect(legacy?.titles?.find((title) => title.id === base.id)?.style).toBeUndefined();
    expect(resolvedTitleStyle(legacy!.titles!.find((title) => title.id === base.id)!)).toMatchObject({ placement: 'free', outlineWidthPx: 0 });
  });

  it('validates bounded complete styles and rejects control-shaped extras', () => {
    const valid = applyCaptionPreset(base, 'clean').style;
    expect(parseTimelineTitleStyle(valid)).toEqual(valid);
    expect(parseTimelineTitleStyle({ ...valid, outlineWidthPx: 25 })).toBeNull();
    expect(parseTimelineTitleStyle({ ...valid, backgroundOpacity: -0.1 })).toBeNull();
    expect(parseTimelineTitleStyle({ ...valid, fontFamily: 'C:/private/font.ttf' })).toBeNull();
  });

  it('resolves title-safe anchors from each output height while retaining fine offsets', () => {
    const bottom = applyCaptionPreset(base, 'clean');
    expect(titleOutputPosition(bottom, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 345.6 });
    expect(titleOutputPosition({ ...bottom, positionY: 10 }, { width: 1080, height: 1920 })).toEqual({ x: 0, y: 624.4 });
    expect(titleOutputPosition({ ...bottom, style: { ...bottom.style!, placement: 'top' } }, { width: 1080, height: 1080 })).toEqual({ x: 0, y: -345.6 });
  });
});
