import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { getLlmModel, type LlmProviderId } from '../shared/llmModels';
import type { AgentChatModelFactory } from './agentChatGraph';
import type { CredentialStore, ProviderCredentials } from './credentialStore';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

export type AgentChatModelSpec =
  | { readonly kind: 'ollama' }
  | {
      readonly kind: 'cloud';
      readonly providerId: LlmProviderId;
      readonly providerLabel: string;
      readonly credentialKey: keyof ProviderCredentials;
      /** OpenAI-compatible providers reuse the OpenAI client with this base URL. */
      readonly openAiCompatibleBaseUrl?: string;
    };

/**
 * Resolve which chat-model client serves a model id. Unknown models fall back
 * to Ollama so custom locally pulled models keep working, matching the
 * pre-provider behavior.
 */
export function resolveAgentChatModelSpec(modelId: string): AgentChatModelSpec {
  const model = getLlmModel(modelId);
  switch (model?.providerId) {
    case 'openai':
      return { kind: 'cloud', providerId: 'openai', providerLabel: 'OpenAI', credentialKey: 'openaiApiKey' };
    case 'anthropic':
      return { kind: 'cloud', providerId: 'anthropic', providerLabel: 'Anthropic', credentialKey: 'anthropicApiKey' };
    case 'google_gemini':
      return { kind: 'cloud', providerId: 'google_gemini', providerLabel: 'Google Gemini', credentialKey: 'geminiApiKey' };
    case 'deepseek':
      return {
        kind: 'cloud',
        providerId: 'deepseek',
        providerLabel: 'DeepSeek',
        credentialKey: 'deepseekApiKey',
        openAiCompatibleBaseUrl: 'https://api.deepseek.com'
      };
    default:
      return { kind: 'ollama' };
  }
}

async function createCloudChatModel(
  spec: Extract<AgentChatModelSpec, { kind: 'cloud' }>,
  modelId: string,
  apiKey: string
): Promise<BaseChatModel> {
  if (spec.providerId === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model: modelId, apiKey });
  }
  if (spec.providerId === 'google_gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    return new ChatGoogleGenerativeAI({ model: modelId, apiKey });
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({
    model: modelId,
    apiKey,
    ...(spec.openAiCompatibleBaseUrl === undefined ? {} : { configuration: { baseURL: spec.openAiCompatibleBaseUrl } })
  });
}

/**
 * Model factory for the Edit Agent graph. The provider is resolved per model
 * id: Ollama models talk to the local engine, cloud models bind the same tool
 * set through their provider's LangChain client with the API key read from
 * main-process safe storage at call time (keys never enter the renderer or
 * the graph config).
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
        const cloudModel = await createCloudChatModel(spec, modelId, apiKey);
        if (cloudModel.bindTools === undefined) {
          throw new Error(`${spec.providerLabel} client does not support tool calling in this build.`);
        }
        const model = cloudModel.bindTools([...tools]);
        return model.invoke([...messages]);
      }
    };
  };
}
