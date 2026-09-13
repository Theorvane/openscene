import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readRepo(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('detach audio surface parity', () => {
  it('wires desktop through validated IPC and keeps mobile limitation visible', async () => {
    const [ipc, preload, handler, main, editor, inspector, mobile] = await Promise.all([
      readRepo('src/shared/ipc.ts'),
      readRepo('src/preload/index.ts'),
      readRepo('src/main/audioDetachIpcHandlers.ts'),
      readRepo('src/main/index.ts'),
      readRepo('src/renderer/src/editor/useTimelineEditor.ts'),
      readRepo('src/renderer/src/editor/InspectorPanel.tsx'),
      readRepo('mobile/src/screens/EditScreen.tsx')
    ]);

    expect(ipc).toContain("projectAssetDetachAudio: 'project-assets:detach-audio'");
    expect(preload).toContain('detachVideoAudio(input: DetachVideoAudioInput)');
    expect(handler).toContain('service.detach(payload)');
    expect(main).toContain('registerAudioDetachIpcHandler(ipcMain, audioDetachService)');
    expect(editor).toContain('detachVideoAudioOnTimeline');
    expect(inspector).toContain('Detach audio');
    expect(mobile).toContain('Detach audio is currently desktop-only');
    expect(mobile).toContain("Mobile keeps the video's embedded sound during preview and export.");
  });
});
