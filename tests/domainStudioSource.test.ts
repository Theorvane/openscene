import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const VIDEO_SOURCE_URL = new URL('../src/renderer/src/VideoGenerationWorkspace.tsx', import.meta.url);
const VOICE_SOURCE_URL = new URL('../src/renderer/src/NarrationPanel.tsx', import.meta.url);

describe('domain generation studio wiring', () => {
  it('uses the voice and video domain selectors instead of the global LLM selector', async () => {
    const [video, voice] = await Promise.all([
      readFile(VIDEO_SOURCE_URL, 'utf8'),
      readFile(VOICE_SOURCE_URL, 'utf8')
    ]);

    expect(video).toContain('domain="video-generation"');
    expect(voice).toContain('domain="voice-generation"');
    expect(voice).toContain("useAiDomainModel()");
    expect(voice).toContain("selectedModel('voice-generation')");
    // Voice generation is cloud-only now; the selected model drives the job.
    expect(voice).toContain('modelId: voiceModel.id');
    expect(video).toContain('modelId: videoModel.id');
    expect(video).not.toContain('LlmModelSelectorBar');
    expect(voice).not.toContain('LlmModelSelectorBar');
  });
});
