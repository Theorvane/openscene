export const THEME_STORAGE_KEY = 'window-loom-theme';
export const THEME_PRESET_STORAGE_KEY = 'window-loom-theme-preset';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export type ThemePresetId = 'dark-zinc' | 'daylight-glass' | 'midnight-neon' | 'obsidian-pro';

export interface ThemePreset {
  readonly id: ThemePresetId;
  readonly label: string;
  readonly mode: ThemeMode;
  readonly description: string;
  readonly accentColor: string;
  readonly bgPreview: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'dark-zinc',
    label: 'Dark Zinc',
    mode: 'dark',
    description: 'Opencode minimalist dark zinc studio',
    accentColor: '#6366f1',
    bgPreview: '#09090b'
  },
  {
    id: 'daylight-glass',
    label: 'Daylight Glass',
    mode: 'light',
    description: 'Vibrant glassmorphic daylight studio',
    accentColor: '#2563eb',
    bgPreview: '#f8faff'
  },
  {
    id: 'midnight-neon',
    label: 'Midnight Neon',
    mode: 'dark',
    description: 'Cyberpunk neon glow studio',
    accentColor: '#f439a0',
    bgPreview: '#06070a'
  },
  {
    id: 'obsidian-pro',
    label: 'Obsidian Pro',
    mode: 'dark',
    description: 'Deep OLED black pro suite',
    accentColor: '#3b82f6',
    bgPreview: '#000000'
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

export function resolveThemePreset(presetId: ThemePresetId, mode: ThemeMode): ThemePresetId {
  const presetConfig = THEME_PRESETS.find((p) => p.id === presetId);
  if (presetConfig !== undefined && presetConfig.mode === mode) {
    return presetId;
  }
  return mode === 'light' ? 'daylight-glass' : 'dark-zinc';
}

export function shouldToggleThemeOnSwitchKeyDown(key: string): boolean {
  return key === ' ' || key === 'Spacebar';
}
