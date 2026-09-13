import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const MAIN_SOURCE_URL = new URL('../src/main/index.ts', import.meta.url);

describe('renderer terminal diagnostics', () => {
  it('reports renderer failures without logging project or prompt payloads', async () => {
    const source = await readFile(MAIN_SOURCE_URL, 'utf8');

    expect(source).toContain("webContents.on('console-message'");
    expect(source).toContain("webContents.on('preload-error'");
    expect(source).toContain("webContents.on('did-fail-load'");
    expect(source).toContain("webContents.on('render-process-gone'");
    expect(source).toContain('[OpenScene][Renderer]');
    const diagnostics = source.slice(
      source.indexOf("mainWindow.webContents.on('console-message'"),
      source.indexOf('const devServerUrl')
    );
    expect(diagnostics).not.toContain('prompt:');
    expect(diagnostics).not.toContain('script:');
  });
});
