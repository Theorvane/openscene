import { useState } from 'react';

import {
  STUDIO_PANEL_DEFAULT_PREFERENCE,
  STUDIO_PANEL_STORAGE_KEY,
  parseStudioPanelPreference,
  serializeStudioPanelPreference,
  type StudioPanelPreference
} from './studioPanelPreferences';

type StudioPanelPreferenceUpdater = (currentPreference: StudioPanelPreference) => StudioPanelPreference;

type UseStudioPanelPreferenceResult = {
  readonly studioPreference: StudioPanelPreference;
  readonly updateStudioPreference: (updater: StudioPanelPreferenceUpdater) => void;
};

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getStoredStudioPanelPreference(): StudioPanelPreference {
  if (typeof window === 'undefined') return STUDIO_PANEL_DEFAULT_PREFERENCE;

  try {
    return parseStudioPanelPreference(window.localStorage.getItem(STUDIO_PANEL_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return STUDIO_PANEL_DEFAULT_PREFERENCE;
    throw error;
  }
}

function persistStudioPanelPreference(preference: StudioPanelPreference): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STUDIO_PANEL_STORAGE_KEY, serializeStudioPanelPreference(preference));
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

export function useStudioPanelPreference(): UseStudioPanelPreferenceResult {
  const [studioPreference, setStudioPreference] = useState<StudioPanelPreference>(() => getStoredStudioPanelPreference());

  const updateStudioPreference = (updater: StudioPanelPreferenceUpdater): void => {
    setStudioPreference((currentPreference) => {
      const nextPreference = updater(currentPreference);
      persistStudioPanelPreference(nextPreference);
      return nextPreference;
    });
  };

  return { studioPreference, updateStudioPreference };
}
