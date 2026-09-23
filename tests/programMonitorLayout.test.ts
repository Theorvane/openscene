import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('allocates the flexible program-monitor row to the picture even without media', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
  const monitor = /\.program-monitor\s*\{([^}]+)\}/.exec(css)?.[1];
  expect(monitor).toContain('grid-template-rows: minmax(0, 1fr) auto;');
  const dock = /\.editor-program-region\s*\{([^}]+)\}/.exec(css)?.[1];
  expect(dock).toContain('grid-template-rows: minmax(0, 1fr);');
});
