export const THEME_STORAGE_KEY = 'window-loom-theme';
export const THEME_PRESET_STORAGE_KEY = 'window-loom-theme-preset';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export type ThemePresetId = 'dark-zinc' | 'daylight-glass' | 'midnight-neon' | 'obsidian-pro';

export interface ThemePresetVariant {
  readonly accentColor: string;
  readonly bgPreview: string;
}

export interface ThemePreset {
  readonly id: ThemePresetId;
  readonly label: string;
  readonly description: string;
  readonly light: ThemePresetVariant;
  readonly dark: ThemePresetVariant;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'dark-zinc',
    label: 'Dark Zinc',
    description: 'Minimalist neutral zinc studio',
    light: {
      accentColor: '#4f46e5',
      bgPreview: '#f8f8f8'
    },
    dark: {
      accentColor: '#818cf8',
      bgPreview: '#101010'
    }
  },
  {
    id: 'daylight-glass',
    label: 'Command Desk',
    description: 'Warm glass studio command desk',
    light: {
      accentColor: '#9a4f1f',
      bgPreview: '#f4efe5'
    },
    dark: {
      accentColor: '#d97706',
      bgPreview: '#141210'
    }
  },
  {
    id: 'midnight-neon',
    label: 'Midnight Neon',
    description: 'Cyberpunk neon glow studio',
    light: {
      accentColor: '#c026d3',
      bgPreview: '#f5f3ff'
    },
    dark: {
      accentColor: '#f439a0',
      bgPreview: '#08090d'
    }
  },
  {
    id: 'obsidian-pro',
    label: 'Obsidian Pro',
    description: 'Deep OLED black & pro slate suite',
    light: {
      accentColor: '#2563eb',
      bgPreview: '#f8fafc'
    },
    dark: {
      accentColor: '#3b82f6',
      bgPreview: '#000000'
    }
  }
] as const;

export function parseThemePreference(storedTheme: string | null | undefined): ThemePreference {
  switch (storedTheme) {
    case 'light':
    case 'dark':
      return storedTheme;
    default:
      return 'system';
  }
}

export function parseThemePreset(storedPreset: string | null | undefined, defaultMode: ThemeMode): ThemePresetId {
  switch (storedPreset) {
    case 'dark-zinc':
    case 'daylight-glass':
    case 'midnight-neon':
    case 'obsidian-pro':
      return storedPreset;
    default:
      return defaultMode === 'light' ? 'daylight-glass' : 'dark-zinc';
  }
}

export function resolveThemeMode(preference: ThemePreference, systemMode: ThemeMode): ThemeMode {
  switch (preference) {
    case 'light':
    case 'dark':
      return preference;
    case 'system':
      return systemMode;
  }
}

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  switch (mode) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'light';
  }
}

export function resolveThemePreset(presetId: ThemePresetId, _mode?: ThemeMode): ThemePresetId {
  const presetConfig = THEME_PRESETS.find((p) => p.id === presetId);
  if (presetConfig !== undefined) {
    return presetId;
  }
  return 'dark-zinc';
}
