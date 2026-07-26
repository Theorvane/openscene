import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getDomainModel,
  parseAiDomainModelPreferences,
  type AiDomain,
  type AiDomainModelConfig,
  type AiDomainModelPreferences
} from '../../shared/aiDomainModels';

type AiDomainModelContextValue = {
  readonly preferences: AiDomainModelPreferences;
  readonly selectedModelId: (domain: AiDomain) => string;
  readonly selectedModel: (domain: AiDomain) => AiDomainModelConfig;
  readonly setSelectedModelId: (domain: AiDomain, modelId: string) => void;
};

const AiDomainModelContext = createContext<AiDomainModelContextValue | null>(null);

function getStoredPreferences(): AiDomainModelPreferences {
  if (typeof window === 'undefined') return parseAiDomainModelPreferences(null);

  try {
    const raw = window.localStorage.getItem(AI_DOMAIN_MODEL_STORAGE_KEY);
    if (raw === null) return parseAiDomainModelPreferences(null);
    return parseAiDomainModelPreferences(JSON.parse(raw) as Partial<Record<AiDomain, string>>);
  } catch {
    return parseAiDomainModelPreferences(null);
  }
}

export function AiDomainModelProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [preferences, setPreferences] = useState<AiDomainModelPreferences>(getStoredPreferences);

  const setSelectedModelId = useCallback((domain: AiDomain, modelId: string): void => {
    setPreferences((current) => {
      const normalized = parseAiDomainModelPreferences({ ...current, [domain]: modelId });
      try {
        window.localStorage.setItem(AI_DOMAIN_MODEL_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // The in-memory preference remains usable when local storage is unavailable.
      }
      return normalized;
    });
  }, []);

  const value = useMemo<AiDomainModelContextValue>(
    () => ({
      preferences,
      selectedModelId: (domain) => preferences[domain],
      selectedModel: (domain) => {
        const model = getDomainModel(domain, preferences[domain]);
        if (model === undefined || !model.available) {
          throw new Error(`No available ${domain} model is selected.`);
        }
        return model;
      },
      setSelectedModelId
    }),
    [preferences, setSelectedModelId]
  );

  return <AiDomainModelContext.Provider value={value}>{children}</AiDomainModelContext.Provider>;
}

export function useAiDomainModel(): AiDomainModelContextValue {
  const context = useContext(AiDomainModelContext);
  if (context === null) {
    throw new Error('useAiDomainModel must be used within AiDomainModelProvider.');
  }
  return context;
}
