import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SELECTOR_SOURCE_URL = new URL('../src/renderer/src/AiDomainModelSelector.tsx', import.meta.url);

describe('AI domain model selector', () => {
  it('filters choices to one domain and explains unavailable options accessibly', async () => {
    const source = await readFile(SELECTOR_SOURCE_URL, 'utf8');

    expect(source).toContain('getDomainModels(domain)');
    expect(source).toContain('disabled={!model.available}');
    expect(source).toContain('aria-describedby');
    expect(source).toContain('role="status"');
    expect(source).not.toContain('DEFAULT_LLM_MODELS');
  });
});
