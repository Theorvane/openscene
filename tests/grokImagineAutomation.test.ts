import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';

import { automateGrokImagineGeneration, buildGrokImaginePrompt, buildGrokImagineStateProbeScript } from '../src/main/grokImagineAutomation';

describe('Grok Imagine browser automation contract', () => {
  it('uses visible public controls and does not contain a private provider endpoint', () => {
    const script = buildGrokImagineStateProbeScript();
    expect(script).toContain('ask grok');
    expect(script).toContain('Hình ảnh');
    expect(script).toContain('Video');
    expect(script).toContain('Gửi');
    expect(script).not.toContain('/api/');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
  });

  it('preserves Grok-only prompt options instead of silently dropping them', () => {
    expect(buildGrokImaginePrompt('A quiet lake', { negativePrompt: 'text, watermark' }))
      .toBe('A quiet lake\nAvoid: text, watermark.');
    expect(buildGrokImaginePrompt('A tracking shot', { stylePreset: 'Neo noir' }))
      .toBe('A tracking shot\nVisual style: Neo noir.');
    expect(buildGrokImaginePrompt('A tracking shot', { stylePreset: 'Workflow controlled' }))
      .toBe('A tracking shot');
  });

  it('fails closed when a requested video control is missing', async () => {
    const rectangle = { x: 0, y: 0, width: 100, height: 40 };
    const state = {
      url: 'https://grok.com/imagine',
      input: rectangle,
      submit: rectangle,
      imageMode: { rectangle, text: 'Image', selected: false },
      videoMode: { rectangle, text: 'Video', selected: true },
      resolutionButton: { rectangle, text: '480p' },
      aspectButton: { rectangle, text: '16:9' },
      images: [],
      videos: []
    };
    const webContents = {
      executeJavaScript: async () => state,
      sendInputEvent: () => undefined,
      insertText: async () => undefined
    } as unknown as WebContents;

    await expect(automateGrokImagineGeneration(webContents, {
      prompt: 'A tracking shot',
      operation: 'text_to_video',
      aspectRatio: '16:9',
      durationSeconds: 6,
      timeoutMs: 1_000
    })).rejects.toThrow('control required to select 6s');
  });

  it('selects 480p and records the media baseline only after prompt setup', () => {
    const source = automateGrokImagineGeneration.toString();
    expect(source).toContain('resolutionButton?.rectangle');
    expect(source).toContain('480p');
    expect(source.indexOf('const existingImages')).toBeGreaterThan(source.indexOf('await fillPrompt'));
    expect(source.indexOf('const existingImages')).toBeLessThan(source.indexOf('state.submit'));
  });
});
