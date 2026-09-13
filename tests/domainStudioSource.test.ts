import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const VIDEO_SOURCE_URL = new URL('../src/renderer/src/VideoGenerationWorkspace.tsx', import.meta.url);
const VOICE_SOURCE_URL = new URL('../src/renderer/src/NarrationPanel.tsx', import.meta.url);
const APP_SOURCE_URL = new URL('../src/renderer/src/App.tsx', import.meta.url);

describe('domain generation studio wiring', () => {
  it('uses the voice and video domain selectors instead of the global LLM selector', async () => {
    const [video, voice, app] = await Promise.all([
      readFile(VIDEO_SOURCE_URL, 'utf8'),
      readFile(VOICE_SOURCE_URL, 'utf8'),
      readFile(APP_SOURCE_URL, 'utf8')
    ]);

    expect(video).toContain('domain="video-generation"');
    expect(voice).toContain('domain="voice-generation"');
    expect(voice).toContain("useAiDomainModel()");
    expect(voice).toContain("selectedModel('voice-generation')");
    // The selected cloud or desktop-local model drives the same typed job.
    expect(voice).toContain('modelId: voiceModel.id');
    expect(voice).toContain('aiListSpeechVoices(voiceModel.id)');
    expect(voice).toContain('poll.value.previewUrl');
    expect(voice).toContain('<audio className="speech-result-review__player"');
    expect(voice).toContain('controls preload="metadata"');
    expect(video).toContain('modelId: targetModelId');
    expect(video).toContain("{ id: 'motion_control', label: 'Motion' }");
    expect(video).toContain('aiGetComfyUiMotionStatus()');
    expect(app).toContain('projectAssets={editor.project?.assets ?? []}');
    expect(video).not.toContain('LlmModelSelectorBar');
    expect(voice).not.toContain('LlmModelSelectorBar');
    expect(app).toContain('editor.project !== null && (');
    expect(app).not.toContain('editor.project!.ai');
  });
});
