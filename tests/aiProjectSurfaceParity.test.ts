import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('AI project domain surface parity', () => {
  it('uses one shared document in desktop persistence, preload and mobile persistence', async () => {
    const [timelineTypes, projectStore, preload, ipc, mobile] = await Promise.all([
      readRepo('src/shared/timelineTypes.ts'),
      readRepo('src/main/projectStore.ts'),
      readRepo('src/preload/index.ts'),
      readRepo('src/shared/ipc.ts'),
      readRepo('mobile/src/lib/projectStore.ts')
    ]);

    expect(timelineTypes).toContain('readonly ai: AiProjectDocument;');
    expect(projectStore).toContain('saveAiProjectDocument(projectId: string, ai: AiProjectDocument');
    expect(preload).toContain('saveAiProjectDocument(input: SaveAiProjectDocumentInput)');
    expect(ipc).toContain("projectAiDocumentSave: 'project-ai-document:save'");
    expect(mobile).toContain("from '@openvideo/shared/aiProjectDomain'");
    expect(mobile).toContain('readonly ai: AiProjectDocument;');
    expect(mobile).toContain('const isLegacyV3 = storedSchemaVersion === 3;');
    expect(mobile).toContain('if (!isLegacyV3 && storedSchemaVersion !== PROJECT_SCHEMA_VERSION) return null;');
    expect(mobile).toContain('parseAiProjectDocument(candidate.ai');
    expect(mobile).toContain('removeAssetFromAiProjectDocument(project.ai, assetId)');
  });

  it('puts Writer on both project surfaces instead of hiding it in settings', async () => {
    const [desktop, mobile] = await Promise.all([
      readRepo('src/renderer/src/App.tsx'),
      readRepo('mobile/App.tsx')
    ]);
    expect(desktop).toContain('<WriterWorkspace document={editor.project.ai} onSave={editor.saveAiProjectDocument} />');
    expect(mobile).toContain('<WriterScreen topInset={0} keyboardOffset={bodyTop} projectId={route.projectId}');
  });
});
