export const AGENT_ROUTER_PROVIDER_ID = 'agentrouter';
export const AGENT_ROUTER_CREDENTIAL_KEY = 'agentRouterApiKey';
/** OpenAI-compatible base URL used by AgentRouter and NewAPI clients. */
export const AGENT_ROUTER_BASE_URL = 'https://agentrouter.org/v1';

export const AGENT_ROUTER_WRITER_DESKTOP_ONLY_REASON =
  'AgentRouter Writer is currently available in OpenScene desktop.';

export const AGENT_ROUTER_EDIT_AGENT_UNAVAILABLE_REASON =
  'AgentRouter Edit Agent is unavailable until OpenScene can preserve tool approvals through its OpenAI-compatible route.';

/**
 * Account model aliases supplied by the user. AgentRouter pools can expose a
 * different set per key, so these are candidates to test rather than a claim
 * that every AgentRouter account has every model.
 */
export const AGENT_ROUTER_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', reasoning: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5', reasoning: true },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', reasoning: true },
  { id: 'glm-5.3', label: 'GLM 5.3', reasoning: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', reasoning: true }
] as const;

export type AgentRouterNativeModelId = (typeof AGENT_ROUTER_MODELS)[number]['id'];
export type AgentRouterModelId = `agentrouter/${AgentRouterNativeModelId}`;

export const AGENT_ROUTER_MODEL_IDS: readonly AgentRouterModelId[] = AGENT_ROUTER_MODELS.map(
  (model) => `${AGENT_ROUTER_PROVIDER_ID}/${model.id}` as AgentRouterModelId
);

export function isAgentRouterModelId(modelId: string): modelId is AgentRouterModelId {
  return (AGENT_ROUTER_MODEL_IDS as readonly string[]).includes(modelId);
}

export function agentRouterNativeModelId(modelId: AgentRouterModelId): AgentRouterNativeModelId {
  return modelId.slice(`${AGENT_ROUTER_PROVIDER_ID}/`.length) as AgentRouterNativeModelId;
}
