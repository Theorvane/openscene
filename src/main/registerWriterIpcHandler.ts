import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import { requestWriter } from '../shared/writerGeneration';
import { AGENT_ROUTER_CREDENTIAL_KEY, isAgentRouterModelId } from '../shared/agentRouter';
import {
  parseWriterGenerationInput,
  type WriterDraft,
  type WriterGenerationInput
} from '../shared/writerWorkflow';
import type { CredentialStore } from './credentialStore';
import { requestAgentRouterHttpWriter } from './agentRouterHttpWriter';
import { fail, ok } from './ipcResponses';

type WriterIpcHandler = (payload?: unknown) => Promise<ApiResponse<WriterDraft>>;

export function registerWriterIpcHandler(dependencies: {
  readonly credentialStore: Pick<CredentialStore, 'getCredentialValue'>;
  readonly registerHandler: (channel: string, handler: WriterIpcHandler) => void;
  readonly generate?: (input: WriterGenerationInput & { readonly apiKey: string }) => Promise<WriterDraft>;
}): void {
  dependencies.registerHandler(IPC_CHANNELS.writerGenerate, async (payload) => {
    const input = parseWriterGenerationInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The Writer request was not valid.');
    const agentRouter = isAgentRouterModelId(input.modelId);
    const credentialKey = agentRouter ? AGENT_ROUTER_CREDENTIAL_KEY : 'geminiApiKey';
    const providerLabel = agentRouter ? 'AgentRouter' : 'Google Gemini';
    const apiKey = (await dependencies.credentialStore.getCredentialValue(credentialKey))?.trim();
    if (!apiKey) return fail('INVALID_INPUT', `${providerLabel} API key is missing. Connect ${providerLabel} in Settings first.`);
    try {
      const draft = dependencies.generate === undefined
        ? agentRouter
          ? await requestAgentRouterHttpWriter({ apiKey, modelId: input.modelId, request: input.request })
          : await requestWriter({ apiKey, modelId: input.modelId, request: input.request })
        : await dependencies.generate({ ...input, apiKey });
      return ok(draft);
    } catch (error) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : `${providerLabel} Writer failed.`);
    }
  });
}
