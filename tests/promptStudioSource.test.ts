import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const PROMPT_STUDIO_SOURCE_URL = new URL('../src/renderer/src/PromptStudioWorkspace.tsx', import.meta.url);
const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);

async function readPromptStudioSource(): Promise<string> {
  return readFile(PROMPT_STUDIO_SOURCE_URL, 'utf8');
}

async function readAppShellSource(): Promise<string> {
  return readFile(APP_SHELL_SOURCE_URL, 'utf8');
}

describe('prompt-first studio source contract', () => {
  it('uses the existing typed video-generation and project-import seams', async () => {
    const source = await readPromptStudioSource();

    expect(source).toContain("window.videoTool.aiGenerateVideo");
    expect(source).toContain("window.videoTool.aiGetVideoJob");
    expect(source).toContain("useProjectResultImport");
    expect(source).toContain("importAiResult(job.id)");
    expect(source).toContain("mode: 'local'");
    expect(source).toContain("aria-pressed={selectedStyle === preset}");
    expect(source).toContain("aria-pressed={aspectRatio === ratio}");
    expect(source).toContain("aria-pressed={durationSeconds === seconds}");
    expect(source).toContain("Prompt Studio");
  });

  it('removes the legacy LLM copilot drawer while retaining the independent agent chat surface', async () => {
    const source = await readAppShellSource();

    expect(source).not.toContain("LlmAssistantCopilot");
    expect(source).not.toContain("<LlmAssistantCopilot />");
    expect(source).toContain("<AgentChatToggleButton />");
    expect(source).toContain("<AgentChatPanel />");
  });
});
