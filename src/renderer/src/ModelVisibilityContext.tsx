import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  MODEL_VISIBILITY_STORAGE_KEY,
  modelVisibilityKey,
  parseHiddenModelKeys,
  serializeHiddenModelKeys,
  withModelVisibility
} from './modelVisibilityPreferences';

type ModelVisibilityContextValue = {
  readonly isModelVisible: (providerId: string, modelId: string) => boolean;
  readonly setModelVisibility: (providerId: string, modelId: string, visible: boolean) => void;
};

const ModelVisibilityContext = createContext<ModelVisibilityContextValue | null>(null);

function getStoredHiddenKeys(): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return parseHiddenModelKeys(window.localStorage.getItem(MODEL_VISIBILITY_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function ModelVisibilityProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(getStoredHiddenKeys);

  const setModelVisibility = useCallback((providerId: string, modelId: string, visible: boolean): void => {
    setHiddenKeys((current) => {
      const next = withModelVisibility(current, modelVisibilityKey(providerId, modelId), visible);
      if (next !== current) {
        try {
          window.localStorage.setItem(MODEL_VISIBILITY_STORAGE_KEY, serializeHiddenModelKeys(next));
        } catch {
          // The in-memory preference remains usable when local storage is unavailable.
        }
      }
      return next;
    });
  }, []);

  const value = useMemo<ModelVisibilityContextValue>(
    () => ({
      isModelVisible: (providerId, modelId) => !hiddenKeys.has(modelVisibilityKey(providerId, modelId)),
      setModelVisibility
    }),
    [hiddenKeys, setModelVisibility]
  );

  return <ModelVisibilityContext.Provider value={value}>{children}</ModelVisibilityContext.Provider>;
}

export function useModelVisibility(): ModelVisibilityContextValue {
  const context = useContext(ModelVisibilityContext);
  if (context === null) {
    throw new Error('useModelVisibility must be used within ModelVisibilityProvider.');
  }
  return context;
}
