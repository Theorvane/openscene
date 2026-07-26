import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const MAIN_SOURCE_URL = new URL('../src/renderer/src/main.tsx', import.meta.url);
const CONTEXT_SOURCE_URL = new URL('../src/renderer/src/AiDomainModelContext.tsx', import.meta.url);

describe('AI domain model renderer preferences', () => {
  it('provides independent domain selections above the application', async () => {
    const [main, context] = await Promise.all([readFile(MAIN_SOURCE_URL, 'utf8'), readFile(CONTEXT_SOURCE_URL, 'utf8')]);

    expect(main).toContain("import { AiDomainModelProvider } from './AiDomainModelContext';");
    expect(main).toContain('<AiDomainModelProvider>');
    expect(context).toContain('AI_DOMAIN_MODEL_STORAGE_KEY');
    expect(context).toContain('setSelectedModelId: (domain: AiDomain, modelId: string)');
    expect(context).toContain('parseAiDomainModelPreferences');
  });
});
