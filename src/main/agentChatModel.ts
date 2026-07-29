import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { getLlmModel, parseLlmModelKey } from '../shared/llmModels';
import { getLlmProvider } from '../shared/llmProviders';
import type { AgentChatModelFactory } from './agentChatGraph';
import type { CredentialStore } from './credentialStore';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

export type AgentChatModelSpec =
  | { readonly kind: 'ollama' }
  | {
      readonly kind: 'cloud';
      readonly providerId: string;
      readonly providerLabel: string;
      readonly adapter: 'openai-compatible' | 'anthropic' | 'gemini';
      readonly credentialKey: string;
      /** Provider-native model id (the part after the provider prefix). */
      readonly rawModelId: string;
      readonly baseUrl?: string;
      /** OpenAI codex-family models are served by the Responses API. */
      readonly useResponsesApi?: boolean;
    };

/**
 * Resolve which chat-model client serves a canonical model key. Unknown keys
 * fall back to Ollama so custom locally pulled models keep working, matching
 * the pre-catalog behavior.
 */
export function resolveAgentChatModelSpec(modelId: string): AgentChatModelSpec {
  const model = getLlmModel(modelId);
  if (model === undefined || model.providerId === 'local_ollama') {
    return { kind: 'ollama' };
  }
  const provider = getLlmProvider(model.providerId);
  if (
    provider === undefined ||
    provider.kind !== 'cloud' ||
    provider.credentialKey === undefined ||
    provider.adapter === 'ollama' ||
    provider.adapter === 'media'
  ) {
    return { kind: 'ollama' };
  }
  const rawModelId = parseLlmModelKey(modelId)?.modelId ?? modelId;
  const useResponsesApi = provider.id === 'openai' && rawModelId.includes('codex');
  return {
    kind: 'cloud',
    providerId: provider.id,
    providerLabel: provider.label,
    adapter: provider.adapter,
    credentialKey: provider.credentialKey,
    rawModelId,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(useResponsesApi ? { useResponsesApi: true } : {})
  };
}

async function createCloudChatModel(
  spec: Extract<AgentChatModelSpec, { kind: 'cloud' }>,
  apiKey: string
): Promise<BaseChatModel> {
  if (spec.adapter === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model: spec.rawModelId, apiKey });
  }
  if (spec.adapter === 'gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    return new ChatGoogleGenerativeAI({ model: spec.rawModelId, apiKey });
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({
    model: spec.rawModelId,
    apiKey,
    ...(spec.useResponsesApi === true ? { useResponsesApi: true } : {}),
    ...(spec.baseUrl === undefined ? {} : { configuration: { baseURL: spec.baseUrl } })
  });
}

/**
 * Model factory for the Edit Agent graph. The provider is resolved per model
 * key: Ollama models talk to the local engine, catalog cloud models bind the
 * same tool set through their provider's LangChain client (Anthropic, Gemini,
 * or any OpenAI-compatible endpoint) with the API key read from main-process
 * safe storage at call time (keys never enter the renderer or the graph
 * config).
 */
export function createAgentChatModel(
  tools: readonly DynamicStructuredTool[],
  credentialStore: CredentialStore | null = null
): AgentChatModelFactory {
  return ({ modelId, ollamaBaseUrl }) => {
    const spec = resolveAgentChatModelSpec(modelId);

    if (spec.kind === 'ollama') {
      const baseUrl = (ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
      const model = new ChatOllama({ model: modelId, baseUrl }).bindTools([...tools]);
      return { invoke: (messages) => model.invoke([...messages]) };
    }

    return {
      invoke: async (messages) => {
        const apiKey = (await credentialStore?.getCredentialValue(spec.credentialKey))?.trim();
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(`API key for ${spec.providerLabel} is missing. Connect the provider in Settings first.`);
        }
        const cloudModel = await createCloudChatModel(spec, apiKey);
        if (cloudModel.bindTools === undefined) {
          throw new Error(`${spec.providerLabel} client does not support tool calling in this build.`);
        }
        const model = cloudModel.bindTools([...tools]);
        return model.invoke([...messages]);
      }
    };
  };
}
