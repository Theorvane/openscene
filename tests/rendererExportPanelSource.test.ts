import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const exportPanelSource = readFileSync(new URL('../src/renderer/src/editor/ExportPanel.tsx', import.meta.url), 'utf8');

describe('renderer export panel source contract', () => {
  it('uses only typed videoTool export calls from the renderer', () => {
    expect(exportPanelSource).toContain('window.videoTool.startExportJob');
    expect(exportPanelSource).toContain('window.videoTool.getExportJob');
    expect(exportPanelSource).toContain('window.videoTool.cancelExportJob');
    expect(exportPanelSource).toContain('window.videoTool.openExportResult');
    expect(exportPanelSource).toContain('window.videoTool.revealExportResult');
    expect(exportPanelSource).toContain('Burn approved captions into MP4');
    expect(exportPanelSource).toContain('SUBTITLE_SIDECAR_FORMATS');
    expect(exportPanelSource).toContain('METADATA_PRIVACY_MODES');
    expect(exportPanelSource).toContain('metadataPrivacyPlan(mode).label');
    expect(exportPanelSource).toContain('Verified metadata before/after');
    expect(exportPanelSource).toContain('metadataPrivacyVerificationSummary');
    expect(exportPanelSource).toContain('export-ID.provenance.json');
    expect(exportPanelSource).toContain('Never targets Content Credentials/C2PA');
    expect(exportPanelSource).not.toContain('ipcRenderer');
  });

  it('does not expose export paths, FFmpeg executable paths, or FFmpeg argv in renderer copy', () => {
    expect(exportPanelSource).not.toMatch(/outputPath|executablePath|argv|args:/);
    expect(exportPanelSource).toContain('never output paths or FFmpeg arguments');
  });
});
