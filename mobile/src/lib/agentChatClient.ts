import { getLlmProvider, type LlmProviderInfo } from '@openvideo/shared/llmProviders';
import { readSlot } from './credentials';
import { customCredentialKey, findCustomProvider, isCustomProviderId } from './customProviders';
import { chatGptCredentials } from './openAiSignIn';
import {
  AGENT_ROUTER_EDIT_AGENT_UNAVAILABLE_REASON,
  AGENT_ROUTER_PROVIDER_ID
} from '@openvideo/shared/agentRouter';

/**
 * A tool-calling chat turn, spoken directly from the device.
 *
 * The desktop runs its agent in the main process because that is where the
 * filesystem and FFmpeg live. Neither exists here, and a phone has no privileged
 * process to route through — so the request goes straight to the provider. The
 * part that matters is unchanged: the model may *propose* a tool call, and this
 * module never runs one. It returns the proposal and the screen decides, which
 * is what makes per-feature permission possible at all.
 *
 * Anthropic and Gemini speak their own wire formats; only the OpenAI-compatible
 * shape is implemented, which is what the large majority of the catalog's
 * providers use. Anything else is reported as unsupported rather than attempted
 * and silently mangled.
 */

// The message shape lives in `chatMemory`, which nothing else depends on, so a
// stored conversation can be read and trimmed without dragging the keystore and
// the browser sign-in in with it. Re-exported here because this is where callers
// already look for it.
export type { ChatMessage, ChatRole, ToolCallProposal } from './chatMemory';
import type { ChatMessage, ToolCallProposal } from './chatMemory';

export type ToolSchema = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

export type ChatTurn =
  | { readonly ok: true; readonly text: string; readonly proposals: readonly ToolCallProposal[] }
  | { readonly ok: false; readonly message: string };

function endpointFor(provider: LlmProviderInfo): string | null {
  if (provider.adapter === 'ollama') {
    return `${provider.baseUrl ?? 'http://localhost:11434'}/v1/chat/completions`;
  }
  if (provider.adapter !== 'openai-compatible' || provider.baseUrl === undefined) return null;
  return `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
}

/** Our message shape mapped onto the OpenAI wire shape. */
function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant' && message.proposals !== undefined && message.proposals.length > 0) {
    return {
      role: 'assistant',
      content: message.content.length > 0 ? message.content : null,
      tool_calls: message.proposals.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      }))
    };
  }
  return { role: message.role, content: message.content };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A model that emits malformed arguments should surface as an empty call the
    // user can reject, not as a crash mid-conversation.
    return {};
  }
}

export async function sendChatTurn(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSchema[];
}): Promise<ChatTurn> {
  // A custom provider is an OpenAI-compatible endpoint by definition — that is
  // the only thing the add form can describe — so it needs no adapter lookup,
  // only its own base URL and key.
  const custom = isCustomProviderId(input.providerId) ? findCustomProvider(input.providerId) : undefined;
  const provider = custom === undefined ? getLlmProvider(input.providerId) : undefined;
  if (custom === undefined && provider === undefined) {
    return { ok: false, message: `Unknown provider ${input.providerId}.` };
  }

  const label = custom?.label ?? provider?.label ?? input.providerId;
  if (input.providerId === AGENT_ROUTER_PROVIDER_ID) {
    return { ok: false, message: AGENT_ROUTER_EDIT_AGENT_UNAVAILABLE_REASON };
  }
  const endpoint =
    custom !== undefined ? `${custom.baseUrl.replace(/\/$/, '')}/chat/completions` : endpointFor(provider as LlmProviderInfo);
  if (endpoint === null) {
    return {
      ok: false,
      message: `${label} speaks the ${provider?.adapter ?? 'unknown'} API, which the mobile client does not implement yet. Pick an OpenAI-compatible provider.`
    };
  }

  const credentialKey = custom !== undefined ? customCredentialKey(custom.id) : provider?.credentialKey;
  const apiKey = credentialKey === undefined ? null : await readSlot(credentialKey);

  // A ChatGPT sign-in is a second way to reach OpenAI, not a replacement: a
  // stored key wins because it is the one the user typed most recently, and the
  // sign-in only serves the models that backend actually runs.
  const chatGpt = apiKey === null && input.providerId === 'openai' ? await chatGptCredentials() : null;
  if (apiKey === null && chatGpt === null && (custom !== undefined || provider?.auth === 'api-key')) {
    return {
      ok: false,
      message: `${label} is not connected — add a key, or sign in with ChatGPT, in Settings.`
    };
  }
  const bearer = apiKey ?? chatGpt?.accessToken ?? null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
        // The Codex backend routes on the account the token belongs to.
        ...(chatGpt?.accountId == null ? {} : { 'ChatGPT-Account-Id': chatGpt.accountId })
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages.map(toWire),
        ...(input.tools.length === 0
          ? {}
          : {
              tools: input.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters }
              }))
            })
      })
    });

    if (!response.ok) {
      const body = await response.text();
      // The provider's own message is more useful than a generic failure, but it
      // can be an entire HTML error page, so it is clipped.
      return { ok: false, message: `${label} returned ${response.status}: ${body.slice(0, 300)}` };
    }

    const payload: unknown = await response.json();
    const message = (payload as { choices?: { message?: Record<string, unknown> }[] }).choices?.[0]?.message;
    if (message === undefined) return { ok: false, message: 'The provider returned no message.' };

    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return {
      ok: true,
      text: typeof message.content === 'string' ? message.content : '',
      proposals: rawCalls.map((call: Record<string, unknown>, index: number) => {
        const fn = (call.function ?? {}) as Record<string, unknown>;
        return {
          id: typeof call.id === 'string' ? call.id : `call-${index}`,
          name: typeof fn.name === 'string' ? fn.name : 'unknown',
          args: parseArgs(fn.arguments)
        };
      })
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The request failed.' };
  }
}
