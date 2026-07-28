import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  parseThemePreference,
  parseThemePreset,
  resolveThemeMode,
  resolveThemePreset,
  THEME_PRESET_STORAGE_KEY,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  toggleThemeMode,
  type ThemeMode,
  type ThemePreference,
  type ThemePresetId
} from './theme';

const DARK_THEME_QUERY = '(prefers-color-scheme: dark)';

type ThemeContextValue = {
  readonly mode: ThemeMode;
  readonly preference: ThemePreference;
  readonly preset: ThemePresetId;
  readonly toggleTheme: () => void;
  readonly setPreset: (preset: ThemePresetId) => void;
  readonly setPreference: (preference: ThemePreference) => void;
};

type ThemeProviderProps = {
  readonly children: ReactNode;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getSystemThemeMode(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_THEME_QUERY).matches ? 'dark' : 'light';
}

function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';

  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return 'system';
    throw error;
  }
}

function getStoredThemePreset(defaultMode: ThemeMode): ThemePresetId {
  if (typeof window === 'undefined') return defaultMode === 'light' ? 'daylight-glass' : 'dark-zinc';

  try {
    return parseThemePreset(window.localStorage.getItem(THEME_PRESET_STORAGE_KEY), defaultMode);
  } catch (error) {
    if (isDomStorageError(error)) return defaultMode === 'light' ? 'daylight-glass' : 'dark-zinc';
    throw error;
  }
}

function persistThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

function persistThemePreset(preset: ThemePresetId): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_PRESET_STORAGE_KEY, preset);
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

function applyDocumentTheme(mode: ThemeMode, preset: ThemePresetId): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.preset = preset;
  root.style.colorScheme = mode;
}

export function bootstrapRendererTheme(): void {
  const preference = getStoredThemePreference();
  const systemMode = getSystemThemeMode();
  const mode = resolveThemeMode(preference, systemMode);
  const storedPreset = getStoredThemePreset(mode);
  const effectivePreset = resolveThemePreset(storedPreset, mode);
  applyDocumentTheme(mode, effectivePreset);
}

export function ThemeProvider({ children }: ThemeProviderProps): ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredThemePreference());
  const [systemMode, setSystemMode] = useState<ThemeMode>(() => getSystemThemeMode());
  const mode = resolveThemeMode(preference, systemMode);
  const [presetState, setPresetState] = useState<ThemePresetId>(() => getStoredThemePreset(mode));

  const effectivePreset = resolveThemePreset(presetState, mode);

  useLayoutEffect(() => {
    applyDocumentTheme(mode, effectivePreset);
  }, [mode, effectivePreset]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQueryList = window.matchMedia(DARK_THEME_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      const nextSystemMode = event.matches ? 'dark' : 'light';
      setSystemMode(nextSystemMode);
    };

    mediaQueryList.addEventListener('change', handleSystemThemeChange);
    return () => mediaQueryList.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const toggleTheme = useCallback((): void => {
    setPreferenceState((currentPreference) => {
      const nextMode = toggleThemeMode(resolveThemeMode(currentPreference, systemMode));
      persistThemePreference(nextMode);
      setPresetState((currentPreset) => {
        const nextPreset = resolveThemePreset(currentPreset, nextMode);
        persistThemePreset(nextPreset);
        return nextPreset;
      });
      return nextMode;
    });
  }, [systemMode]);

  const setPreset = useCallback((nextPreset: ThemePresetId): void => {
    setPresetState(nextPreset);
    persistThemePreset(nextPreset);
  }, []);

  const setPreference = useCallback(
    (nextPreference: ThemePreference): void => {
      setPreferenceState(nextPreference);
      persistThemePreference(nextPreference);
      const nextMode = resolveThemeMode(nextPreference, systemMode);
      setPresetState((currentPreset) => {
        const validPreset = resolveThemePreset(currentPreset, nextMode);
        persistThemePreset(validPreset);
        return validPreset;
      });
    },
    [systemMode]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, preference, preset: effectivePreset, toggleTheme, setPreset, setPreference }),
    [mode, preference, effectivePreset, toggleTheme, setPreset, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }
  return context;
}
