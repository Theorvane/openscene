import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  DEFAULT_LLM_MODELS,
  LLM_STORAGE_CONFIG_KEY,
  LLM_STORAGE_MODEL_KEY,
  parseSelectedLlmModelId,
  type LlmModelConfig,
  type LlmProviderApiConfig
} from '../../shared/llmModels';

type LlmContextValue = {
  readonly selectedModelId: string;
  readonly selectedModel: LlmModelConfig;
  readonly providerConfig: LlmProviderApiConfig;
  readonly setSelectedModelId: (id: string) => void;
  readonly updateProviderConfig: (updates: Partial<LlmProviderApiConfig>) => void;
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
    const parsed = JSON.parse(raw) as LlmProviderApiConfig;
    return {
      ollamaBaseUrl: parsed.ollamaBaseUrl || 'http://localhost:11434',
      openaiApiKey: parsed.openaiApiKey || '',
      anthropicApiKey: parsed.anthropicApiKey || '',
      geminiApiKey: parsed.geminiApiKey || '',
      deepseekApiKey: parsed.deepseekApiKey || ''
    };
  } catch {
    return { ollamaBaseUrl: 'http://localhost:11434' };
  }
}

export function LlmProvider({ children }: LlmProviderProps): ReactElement {
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => getStoredModelId());
  const [providerConfig, setProviderConfigState] = useState<LlmProviderApiConfig>(() => getStoredProviderConfig());

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

  const updateProviderConfig = useCallback((updates: Partial<LlmProviderApiConfig>): void => {
    setProviderConfigState((prev) => {
      const next = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LLM_STORAGE_CONFIG_KEY, JSON.stringify(next));
        } catch {
          // storage fallback
        }
      }
      return next;
    });
  }, []);

  const value = useMemo<LlmContextValue>(
    () => ({ selectedModelId, selectedModel, providerConfig, setSelectedModelId, updateProviderConfig }),
    [selectedModelId, selectedModel, providerConfig, setSelectedModelId, updateProviderConfig]
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
