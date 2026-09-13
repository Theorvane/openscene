import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('metadata privacy surface parity', () => {
  it('shares the policy, keeps file work in main, and states the mobile limitation', async () => {
    const [shared, desktop, main, preload, mobile] = await Promise.all([
      source('src/shared/metadataPrivacy.ts'),
      source('src/renderer/src/editor/ExportPanel.tsx'),
      source('src/main/exportIpcService.ts'),
      source('src/preload/index.ts'),
      source('mobile/src/screens/EditScreen.tsx')
    ]);
    expect(shared).toContain('PERSONAL_CONTAINER_METADATA_FIELDS');
    expect(desktop).toContain("metadataPrivacyPlan(metadataPrivacyMode)");
    expect(main).toContain('writeExportProvenanceSidecar(');
    expect(main).toContain('hashExportOutput(prepared.outputPath)');
    expect(preload).not.toMatch(/provenanceOutputPath|sha256Export|ffmpegMetadataPrivacyArgs/);
    expect(mobile).toContain('Metadata privacy and provenance: desktop-only');
    expect(mobile).toContain("metadataPrivacyPlan('privacy_clean')");
  });
});
