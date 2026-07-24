import { ChatOllama } from '@langchain/ollama';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AgentChatModelFactory } from './agentChatGraph';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Local-only per the agent chat MVP decision: cloud LLM providers are not wired into tool-calling
 * yet (see docs/hybrid-ai-editor-direction.md §4.2/§8 — a connected provider path needs its own
 * reviewed design).
 */
export function createOllamaAgentChatModel(tools: readonly DynamicStructuredTool[]): AgentChatModelFactory {
  return ({ modelId, ollamaBaseUrl }) => {
    const baseUrl = (ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
    const model = new ChatOllama({ model: modelId, baseUrl }).bindTools([...tools]);
    return { invoke: (messages) => model.invoke([...messages]) };
  };
}
