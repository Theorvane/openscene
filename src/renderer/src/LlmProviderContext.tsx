import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  DEFAULT_LLM_MODELS,
  LLM_STORAGE_CONFIG_KEY,
  LLM_STORAGE_MODEL_KEY,
  parseSelectedLlmModelId,
  type LlmModelConfig,
  type LlmProviderApiConfig
} from '../../shared/llmModels';

/** Any provider credential slot: legacy named keys plus catalog provider ids. */
export type LlmCredentialKey = string;

type LlmContextValue = {
  readonly selectedModelId: string;
  readonly selectedModel: LlmModelConfig;
  readonly providerConfig: LlmProviderApiConfig;
  readonly credentialStatus: Record<string, boolean>;
  readonly setSelectedModelId: (id: string) => void;
  readonly updateProviderConfig: (updates: Partial<LlmProviderApiConfig>) => void;
  readonly saveProviderCredential: (key: LlmCredentialKey, value: string) => Promise<boolean>;
};

type LlmProviderProps = {
  readonly children: ReactNode;
};

const LlmContext = createContext<LlmContextValue | null>(null);

function getStoredModelId(): string {
  if (typeof window === 'undefined') return DEFAULT_LLM_MODELS[0]!.id;
  try {
    return parseSelectedLlmModelId(window.localStorage.getItem(LLM_STORAGE_MODEL_KEY));
  } catch {
    return DEFAULT_LLM_MODELS[0]!.id;
  }
}

function getStoredProviderConfig(): LlmProviderApiConfig {
  if (typeof window === 'undefined') return { ollamaBaseUrl: 'http://localhost:11434' };
  try {
    const raw = window.localStorage.getItem(LLM_STORAGE_CONFIG_KEY);
    if (!raw) return { ollamaBaseUrl: 'http://localhost:11434' };
    const parsed = JSON.parse(raw) as { ollamaBaseUrl?: string };
    return {
      ollamaBaseUrl: parsed.ollamaBaseUrl || 'http://localhost:11434'
    };
  } catch {
    return { ollamaBaseUrl: 'http://localhost:11434' };
  }
}

export function LlmProvider({ children }: LlmProviderProps): ReactElement {
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => getStoredModelId());
  const [providerConfig, setProviderConfigState] = useState<LlmProviderApiConfig>(() => getStoredProviderConfig());
  const [credentialStatus, setCredentialStatus] = useState<Record<string, boolean>>({});

  // Query credential status from main process without pulling secrets into renderer JS.
  useEffect(() => {
    let isMounted = true;
    if (typeof window !== 'undefined' && window.videoTool?.getProviderCredentialStatus) {
      window.videoTool
        .getProviderCredentialStatus()
        .then((response) => {
          if (isMounted && response.ok && response.value) {
            setCredentialStatus(response.value);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedModel = useMemo<LlmModelConfig>(() => {
    const match = DEFAULT_LLM_MODELS.find((m) => m.id === selectedModelId);
    return match !== undefined ? match : DEFAULT_LLM_MODELS[0]!;
  }, [selectedModelId]);

  const setSelectedModelId = useCallback((id: string): void => {
    setSelectedModelIdState(id);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LLM_STORAGE_MODEL_KEY, id);
      } catch {
        // storage fallback
      }
    }
  }, []);

  const saveProviderCredential = useCallback(async (key: LlmCredentialKey, value: string): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    const response = await window.videoTool.setProviderCredential(key, value);
    if (!response.ok) return false;

    setCredentialStatus((current) => ({ ...current, [key]: value.trim().length > 0 }));
    return response.value.updated;
  }, []);

  const updateProviderConfig = useCallback((updates: Partial<LlmProviderApiConfig>): void => {
    setProviderConfigState((prev) => {
      const next = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LLM_STORAGE_CONFIG_KEY, JSON.stringify({ ollamaBaseUrl: next.ollamaBaseUrl }));
        } catch {
          // storage fallback
        }
      }
      return next.ollamaBaseUrl === undefined ? {} : { ollamaBaseUrl: next.ollamaBaseUrl };
    });
  }, []);

  const value = useMemo<LlmContextValue>(
    () => ({ selectedModelId, selectedModel, providerConfig, credentialStatus, setSelectedModelId, updateProviderConfig, saveProviderCredential }),
    [selectedModelId, selectedModel, providerConfig, credentialStatus, setSelectedModelId, updateProviderConfig, saveProviderCredential]
  );

  return <LlmContext.Provider value={value}>{children}</LlmContext.Provider>;
}

export function useLlmModel(): LlmContextValue {
  const context = useContext(LlmContext);
  if (context === null) {
    throw new Error('useLlmModel must be used within LlmProvider.');
  }
  return context;
}
