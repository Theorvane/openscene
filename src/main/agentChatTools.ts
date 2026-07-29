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
  'trimTimelineClip',
  'updateClipEffects',
  'addClipToTimeline',
  'importGeneratedResult',
  'exportProjectVideo'
]);

export async function createAgentChatTools(instance: OpenVideoMcpServer): Promise<readonly DynamicStructuredTool[]> {
  const resolver: InstanceResolver<OpenVideoMcpServer> = { resolve: () => instance };
  return createLangChainTools(OpenVideoMcpServer, { resolver });
}
