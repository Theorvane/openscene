import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseThemePreset,
  resolveThemePreset,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  THEME_PRESET_STORAGE_KEY,
} from '../src/renderer/src/theme';

const stablePresetIds = ['dark-zinc', 'daylight-glass', 'midnight-neon', 'obsidian-pro'] as const;

describe('theme preset configuration and helper functions', () => {
  it('defines valid visual presets with light and dark variants including required accent colors', () => {
    expect(THEME_PRESETS.length).toBe(4);
    const presetIds = THEME_PRESETS.map((p) => p.id);
    expect(presetIds).toEqual(stablePresetIds);

    for (const preset of THEME_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.light.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.light.bgPreview).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.dark.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.dark.bgPreview).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('parses stored preset IDs with a consistent professional fallback', () => {
    expect(parseThemePreset('dark-zinc', 'dark')).toBe('dark-zinc');
    expect(parseThemePreset('midnight-neon', 'dark')).toBe('midnight-neon');
    expect(parseThemePreset('daylight-glass', 'light')).toBe('daylight-glass');
    expect(parseThemePreset('obsidian-pro', 'dark')).toBe('obsidian-pro');

    expect(parseThemePreset(null, 'dark')).toBe('obsidian-pro');
    expect(parseThemePreset(undefined, 'light')).toBe('obsidian-pro');
    expect(parseThemePreset('invalid-preset', 'dark')).toBe('obsidian-pro');
  });

  it('preserves all theme presets across both light and dark modes', () => {
    // All presets remain active in dark mode
    expect(resolveThemePreset('midnight-neon', 'dark')).toBe('midnight-neon');
    expect(resolveThemePreset('obsidian-pro', 'dark')).toBe('obsidian-pro');
    expect(resolveThemePreset('dark-zinc', 'dark')).toBe('dark-zinc');
    expect(resolveThemePreset('daylight-glass', 'dark')).toBe('daylight-glass');

    // All presets also remain active in light mode
    expect(resolveThemePreset('midnight-neon', 'light')).toBe('midnight-neon');
    expect(resolveThemePreset('obsidian-pro', 'light')).toBe('obsidian-pro');
    expect(resolveThemePreset('daylight-glass', 'light')).toBe('daylight-glass');
    expect(resolveThemePreset('dark-zinc', 'light')).toBe('dark-zinc');
  });

  it('uses the window-loom-theme-preset storage key identifier', () => {
    expect(THEME_PRESET_STORAGE_KEY).toBe('window-loom-theme-preset');
  });

  it('uses the window-loom-theme storage key identifier for mode compatibility', () => {
    expect(THEME_STORAGE_KEY).toBe('window-loom-theme');
  });

  it('uses the professional preset as fallback without changing saved preset identifiers', () => {
    expect(parseThemePreset('missing', 'light')).toBe('obsidian-pro');
    expect(parseThemePreset('missing', 'dark')).toBe('obsidian-pro');
  });
  it('provides matching professional palette previews for both system theme modes', () => {
    const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const preset = THEME_PRESETS.find(item => item.id === 'obsidian-pro')!;
    for (const mode of ['light', 'dark'] as const) {
      const blocks = [...css.matchAll(new RegExp(`:root\\[data-preset="obsidian-pro"\\]\\[data-theme="${mode}"\\]\\s*\\{([^}]+)\\}`, 'g'))];
      const block = blocks.at(-1)?.[1];
      expect(block).toContain(`--background: ${preset[mode].bgPreview};`);
      expect(block).toContain(`--primary: ${preset[mode].accentColor};`);
      expect(block).toContain(`color-scheme: ${mode};`);
    }
  });
});
