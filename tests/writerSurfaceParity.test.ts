import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Writer surface parity', () => {
  it('uses the same shared generation and document application rules on desktop and mobile', async () => {
    const [desktop, mobile, preload, main, editor] = await Promise.all([
      readRepo('src/renderer/src/WriterWorkspace.tsx'),
      readRepo('mobile/src/screens/WriterScreen.tsx'),
      readRepo('src/preload/index.ts'),
      readRepo('src/main/registerWriterIpcHandler.ts'),
      readRepo('src/renderer/src/editor/useTimelineEditor.ts')
    ]);
    expect(desktop).toContain("from '../../shared/writerWorkflow'");
    expect(desktop).toContain('applyWriterDraft({');
    expect(mobile).toContain("from '@openvideo/shared/writerWorkflow'");
    expect(mobile).toContain("from '@openvideo/shared/writerGeneration'");
    expect(mobile).toContain("isDomainModelAvailableOnRuntime(model, 'mobile')");
    expect(mobile).toContain('requestWriter({');
    expect(mobile).toContain('applyWriterDraft({');
    expect(preload).toContain('generateWriterDraft(input: WriterGenerationInput)');
    expect(main).toContain("const credentialKey = agentRouter ? AGENT_ROUTER_CREDENTIAL_KEY : 'geminiApiKey'");
    expect(main).toContain('getCredentialValue(credentialKey)');
    expect(main).toContain('requestWriter({');
    expect(main).toContain('requestAgentRouterHttpWriter({');
    expect(editor).toContain('current.id !== response.value.id');
    expect(editor).toContain('ai: response.value.ai');
  });

  it('keeps raw API keys out of desktop Writer components and IPC request types', async () => {
    const [desktop, workflow] = await Promise.all([
      readRepo('src/renderer/src/WriterWorkspace.tsx'),
      readRepo('src/shared/writerWorkflow.ts')
    ]);
    expect(desktop).not.toContain('apiKey');
    expect(workflow.slice(workflow.indexOf('export type WriterGenerationInput'), workflow.indexOf('export type WriterDraftCharacter'))).not.toContain('apiKey');
  });
});
