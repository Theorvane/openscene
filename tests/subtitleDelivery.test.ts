import { describe, expect, it } from 'vitest';

import { automaticCaptionTitles, createSubtitleSidecar, timelineForSubtitleDelivery } from '../src/shared/subtitleDelivery';
import { createInitialTimeline } from '../src/shared/timelineLogic';

const timeline = {
  ...createInitialTimeline(),
  titles: [
    { id: 'manual-title', text: 'Chapter 1', timelineStartMs: 0, timelineEndMs: 4_000, sizePx: 72, color: '#ffffff', positionX: 0, positionY: 0 },
    { id: 'transcript-caption-b-2', text: 'Second\nline', timelineStartMs: 2_500, timelineEndMs: 4_000, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 360 },
    { id: 'auto-caption-a-1', text: 'Xin chào', timelineStartMs: 1_000, timelineEndMs: 2_400, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 360 }
  ]
};

describe('subtitle delivery', () => {
  it('separates automatic captions from manual titles and preserves the original document', () => {
    expect(automaticCaptionTitles(timeline).map((title) => title.id)).toEqual(['auto-caption-a-1', 'transcript-caption-b-2']);
    expect(timelineForSubtitleDelivery(timeline, { burnAutomaticCaptions: false, sidecarFormat: 'srt' }).titles?.map((title) => title.id)).toEqual(['manual-title']);
    expect(timelineForSubtitleDelivery(timeline, { burnAutomaticCaptions: true, sidecarFormat: 'none' })).toBe(timeline);
    expect(timeline.titles).toHaveLength(3);
  });

  it('serializes deterministic UTF-8 SRT and WebVTT timing', () => {
    expect(createSubtitleSidecar(timeline, 'srt').contents).toBe('1\n00:00:01,000 --> 00:00:02,400\nXin chào\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond\nline\n');
    expect(createSubtitleSidecar(timeline, 'vtt').contents).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.400\nXin chào\n\n00:00:02.500 --> 00:00:04.000\nSecond\nline\n');
  });

  it('serializes ASS while neutralizing override-tag input', () => {
    const unsafe = { ...timeline, titles: [{ ...timeline.titles[1]!, text: '{\\pos(0,0)} A\\B' }] };
    const sidecar = createSubtitleSidecar(unsafe, 'ass');
    expect(sidecar.contents).toContain('PlayResX: 1920');
    expect(sidecar.contents).toContain('Dialogue: 0,0:00:02.50,0:00:04.00,Caption1');

    const portraitSidecar = createSubtitleSidecar(unsafe, 'ass', { width: 1_080, height: 1_920 });
    expect(portraitSidecar.contents).toContain('PlayResX: 1080\nPlayResY: 1920');
    expect(portraitSidecar.contents).toContain('{\\pos(540,1320)}');
    expect(sidecar.contents).toContain('{\\pos(960,900)}｛⧵pos(0,0)｝ A⧵B');
  });

  it('refuses sidecar export when no approved automatic captions are on the timeline', () => {
    expect(() => createSubtitleSidecar(createInitialTimeline(), 'srt')).toThrow('Apply approved automatic captions');
    expect(() => createSubtitleSidecar({ ...timeline, titles: [{ ...timeline.titles[1]!, text: 'x'.repeat(501) }] }, 'srt')).toThrow('bounded subtitle delivery contract');
  });
});
