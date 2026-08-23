import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { InstanceResolver } from '@theorvane/type-mcp';
import { createLangChainTools } from '@theorvane/type-mcp/langchain';
import { OpenVideoMcpServer } from './openVideoMcpServer';

/**
 * The tools that read and change nothing.
 *
 * Written as the read-only list rather than as the mutating one, because the
 * graph asks the question in a way that fails open:
 *
 *     const decision = mutatingToolNames.has(call.name) ? toolDecisions[call.id] : 'approve';
 *
 * A name that is missing from a *mutating* list is auto-approved, so forgetting
 * to add a tool means it writes to someone's project without asking — and that
 * is not hypothetical: `splitTimelineClip`, `addTimelineTitle`,
 * `removeTimelineTitle` and `setTimelineTransition` all shipped that way, while
 * the README promised "anything that writes to your project or starts a job
 * pauses for approval first".
 *
 * Inverted, the cost of forgetting is one unnecessary prompt. Six names change
 * rarely; the tools that touch a project change often.
 *
 * (See docs/hybrid-ai-editor-direction.md §2.2/§4.3.)
 */
export const AGENT_CHAT_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'planVideoScenario',
  'checkNarrationLength',
  'estimateGenerationCost',
  'getJobStatus',
  'getProjectTimeline',
  'watchProjectVideo'
]);

/**
 * Everything the agent can call that is not on that list.
 *
 * Derived from the tools themselves rather than kept as a second list, so the
 * two cannot drift — which is the failure this replaces.
 */
export function agentChatMutatingToolNames(tools: readonly { readonly name: string }[]): ReadonlySet<string> {
  return new Set(tools.map((tool) => tool.name).filter((name) => !AGENT_CHAT_READ_ONLY_TOOL_NAMES.has(name)));
}

export async function createAgentChatTools(instance: OpenVideoMcpServer): Promise<readonly DynamicStructuredTool[]> {
  const resolver: InstanceResolver<OpenVideoMcpServer> = { resolve: () => instance };
  return createLangChainTools(OpenVideoMcpServer, { resolver });
}

/**
 * Tools that bill the user's provider account. These are approved per call and
 * are deliberately excluded from the always-allow shortcut: "always" is a
 * reasonable answer to "may I trim this clip again", and an unreasonable one to
 * "may I charge your card whenever I like". Every charge stays visible.
 */
export const AGENT_CHAT_SPEND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'createVideoJob',
  'createSpeechJob',
  'createImageJob'
]);
