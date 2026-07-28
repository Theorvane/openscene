import { describe, expect, it } from 'vitest';
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

  it('parses stored preset IDs with fallback based on default mode', () => {
    expect(parseThemePreset('dark-zinc', 'dark')).toBe('dark-zinc');
    expect(parseThemePreset('midnight-neon', 'dark')).toBe('midnight-neon');
    expect(parseThemePreset('daylight-glass', 'light')).toBe('daylight-glass');
    expect(parseThemePreset('obsidian-pro', 'dark')).toBe('obsidian-pro');

    expect(parseThemePreset(null, 'dark')).toBe('dark-zinc');
    expect(parseThemePreset(undefined, 'light')).toBe('daylight-glass');
    expect(parseThemePreset('invalid-preset', 'dark')).toBe('dark-zinc');
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

  it('keeps daylight-glass and dark-zinc as mode fallback compatibility identifiers', () => {
    expect(parseThemePreset('missing', 'light')).toBe('daylight-glass');
    expect(parseThemePreset('missing', 'dark')).toBe('dark-zinc');
  });
});
