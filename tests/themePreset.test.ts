import { describe, expect, it } from 'vitest';
import {
  parseThemePreset,
  resolveThemePreset,
  THEME_PRESETS,
  THEME_PRESET_STORAGE_KEY,
  type ThemePresetId
} from '../src/renderer/src/theme';

describe('theme preset configuration and helper functions', () => {
  it('defines valid visual presets with required labels, mode, and accent colors', () => {
    expect(THEME_PRESETS.length).toBe(4);
    const presetIds = THEME_PRESETS.map((p) => p.id);
    expect(presetIds).toEqual(['dark-zinc', 'daylight-glass', 'midnight-neon', 'obsidian-pro']);

    for (const preset of THEME_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.bgPreview).toMatch(/^#[0-9a-fA-F]{6}$/);
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

  it('resolves presets matching active mode and falls back when mode mismatches', () => {
    // Dark mode matching presets stay intact
    expect(resolveThemePreset('midnight-neon', 'dark')).toBe('midnight-neon');
    expect(resolveThemePreset('obsidian-pro', 'dark')).toBe('obsidian-pro');
    expect(resolveThemePreset('dark-zinc', 'dark')).toBe('dark-zinc');

    // Light mode matching preset stays intact
    expect(resolveThemePreset('daylight-glass', 'light')).toBe('daylight-glass');

    // Mismatched mode presets fall back to mode-compatible default
    expect(resolveThemePreset('midnight-neon', 'light')).toBe('daylight-glass');
    expect(resolveThemePreset('obsidian-pro', 'light')).toBe('daylight-glass');
    expect(resolveThemePreset('daylight-glass', 'dark')).toBe('dark-zinc');
  });

  it('uses the window-loom-theme-preset storage key identifier', () => {
    expect(THEME_PRESET_STORAGE_KEY).toBe('window-loom-theme-preset');
  });
});
