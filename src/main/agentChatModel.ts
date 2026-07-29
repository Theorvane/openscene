import { randomUUID } from 'node:crypto';

import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { getLlmModel, parseLlmModelKey } from '../shared/llmModels';
import { getLlmProvider } from '../shared/llmProviders';
import { isOpenAiCodexModelKey, type ReasoningEffort } from '../shared/openAiAuth';
import type { OpenAiAuthMode } from '../shared/openAiAuth';
import type { AgentChatModelFactory } from './agentChatGraph';
import type { CredentialStore } from './credentialStore';
import { CHATGPT_CODEX_ENDPOINT_METADATA, chatGptCodexClientHeaders } from './chatGptOAuthService';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

export type AgentChatModelSpec =
  | { readonly kind: 'ollama' }
  | {
      readonly kind: 'chatgpt-codex';
      readonly providerId: 'openai';
      readonly providerLabel: 'OpenAI';
      readonly rawModelId: string;
      readonly baseUrl: string;
      readonly accountIdHeader: string;
      readonly useResponsesApi: true;
    }
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

type ChatGptCodexCredentials = {
  readonly accessToken: string;
  readonly accountId: string;
};

type ChatGptOAuthCredentialsService = {
  readonly acquireCredentials: () => Promise<ChatGptCodexCredentials>;
};

export class AgentChatModelConfigurationError extends Error {
  override readonly name = 'AgentChatModelConfigurationError';
}

/**
 * Resolve which chat-model client serves a canonical model key. Unknown keys
 * fall back to Ollama so custom locally pulled models keep working, matching
 * the pre-catalog behavior.
 */
export function resolveAgentChatModelSpec(
  modelId: string,
  openAiAuthMode: OpenAiAuthMode = 'api-key'
): AgentChatModelSpec {
  const model = getLlmModel(modelId);
  const parsedModel = parseLlmModelKey(modelId);
  if (openAiAuthMode === 'chatgpt') {
    if (model === undefined || parsedModel === null || model.providerId !== 'openai' || parsedModel.providerId !== 'openai') {
      throw new AgentChatModelConfigurationError(
        'ChatGPT authentication supports only canonical OpenAI Codex-family models for Edit Agent.'
      );
    }
    if (!isOpenAiCodexModelKey(modelId)) {
      throw new AgentChatModelConfigurationError(
        `ChatGPT authentication cannot run Edit Agent model "${modelId}" because the ChatGPT backend does not serve it.`
      );
    }
    return {
      kind: 'chatgpt-codex',
      providerId: 'openai',
      providerLabel: 'OpenAI',
      rawModelId: parsedModel.modelId,
      baseUrl: CHATGPT_CODEX_ENDPOINT_METADATA.baseUrl,
      accountIdHeader: CHATGPT_CODEX_ENDPOINT_METADATA.accountIdHeader,
      useResponsesApi: true
    };
  }
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

export function resolveChatGptCodexClientConfig(
  spec: Extract<AgentChatModelSpec, { kind: 'chatgpt-codex' }>,
  credentials: ChatGptCodexCredentials,
  sessionId: string,
  reasoningEffort?: ReasoningEffort | undefined
) {
  return {
    model: spec.rawModelId,
    apiKey: credentials.accessToken,
    useResponsesApi: spec.useResponsesApi,
    // The ChatGPT backend answers only server-sent events, and it refuses
    // server-side response storage. `streaming` makes invoke() stream and
    // reassemble; `zdrEnabled` is LangChain's switch for `store: false`.
    // Sending neither is what returns a bare "400 (no body)".
    streaming: true,
    zdrEnabled: true,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    configuration: {
      baseURL: spec.baseUrl,
      defaultHeaders: {
        Authorization: `Bearer ${credentials.accessToken}`,
        [spec.accountIdHeader]: credentials.accountId,
        ...chatGptCodexClientHeaders(sessionId)
      }
    }
  };
}

async function createCloudChatModel(
  spec: Extract<AgentChatModelSpec, { kind: 'cloud' }>,
  apiKey: string,
  reasoningEffort: ReasoningEffort | undefined
): Promise<BaseChatModel> {
  if (spec.adapter === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({
      model: spec.rawModelId,
      apiKey,
      // Anthropic-compatible gateways keep the wire format under their own host.
      ...(spec.baseUrl === undefined ? {} : { anthropicApiUrl: spec.baseUrl })
    });
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
    // Only OpenAI-family reasoning models accept an effort setting; other
    // OpenAI-compatible endpoints ignore an unknown field, so gate on provider.
    ...(reasoningEffort !== undefined && spec.providerId === 'openai' ? { reasoningEffort } : {}),
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
  credentialStore: CredentialStore | null = null,
  chatGptOAuthService: ChatGptOAuthCredentialsService | null = null
): AgentChatModelFactory {
  return ({ modelId, ollamaBaseUrl, openAiAuthMode, reasoningEffort }) => {
    const spec = resolveAgentChatModelSpec(modelId, openAiAuthMode);

    if (spec.kind === 'ollama') {
      const baseUrl = (ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
      const model = new ChatOllama({ model: modelId, baseUrl }).bindTools([...tools]);
      return { invoke: (messages) => model.invoke([...messages]) };
    }

    if (spec.kind === 'chatgpt-codex') {
      return {
        invoke: async (messages) => {
          if (chatGptOAuthService === null) {
            throw new AgentChatModelConfigurationError('ChatGPT authentication is unavailable for Edit Agent.');
          }
          const credentials = await chatGptOAuthService.acquireCredentials();
          const { ChatOpenAI } = await import('@langchain/openai');
          const cloudModel = new ChatOpenAI(
            resolveChatGptCodexClientConfig(spec, credentials, randomUUID(), reasoningEffort)
          );
          const model = cloudModel.bindTools([...tools]);
          return model.invoke([...messages]);
        }
      };
    }

    return {
      invoke: async (messages) => {
        const apiKey = (await credentialStore?.getCredentialValue(spec.credentialKey))?.trim();
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(`API key for ${spec.providerLabel} is missing. Connect the provider in Settings first.`);
        }
        const cloudModel = await createCloudChatModel(spec, apiKey, reasoningEffort);
        if (cloudModel.bindTools === undefined) {
          throw new Error(`${spec.providerLabel} client does not support tool calling in this build.`);
        }
        const model = cloudModel.bindTools([...tools]);
        return model.invoke([...messages]);
      }
    };
  };
}
