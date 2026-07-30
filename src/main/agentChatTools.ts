import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { InstanceResolver } from '@theorvane/type-mcp';
import { createLangChainTools } from '@theorvane/type-mcp/langchain';
import { OpenVideoMcpServer } from './openVideoMcpServer';

/**
 * Tools that mutate a saved project, write files, or start a generation job must be approved by
 * the user before executing (see docs/hybrid-ai-editor-direction.md §2.2/§4.3). Read-only tools
 * (job status lookups) execute immediately.
 */
export const AGENT_CHAT_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'createVideoJob',
  'createSpeechJob',
  'createImageJob',
  'trimTimelineClip',
  'updateClipEffects',
  'addClipToTimeline',
  'removeTimelineClip',
  'importGeneratedResult',
  'exportProjectVideo'
]);

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
