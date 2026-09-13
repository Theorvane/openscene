import type { WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  automateGoogleFlowImageGeneration,
  buildGoogleFlowStateProbeScript,
  detectDownloadedImageMime,
  flowConfigurationHasExactModel,
  flowOrientationForAspectRatio,
  renameGoogleFlowProject
} from '../src/main/googleFlowImageAutomation';

afterEach(() => {
  vi.useRealTimers();
});

describe('Google Flow browser image automation', () => {
  it('emits syntactically valid JavaScript for the live Flow DOM probe', () => {
    const script = buildGoogleFlowStateProbeScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('attentionText');
    expect(script).toContain('uploadLauncherEntry');
    expect(script).toContain('uploadChoiceEntry');
    expect(script).not.toContain("/rate limit|usage limit|not enough credits|insufficient credits|hết tín dụng|đã đạt giới hạn/.test(body)");
  });

  it('recognizes supported image signatures rather than trusting a filename', () => {
    expect(detectDownloadedImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectDownloadedImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectDownloadedImageMime(Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
    ]))).toBe('image/webp');
    expect(detectDownloadedImageMime(new TextEncoder().encode('<html>sign in</html>'))).toBeNull();
  });

  it('maps exact ratios onto the coarse orientation available in Flow', () => {
    expect(flowOrientationForAspectRatio('16:9')).toBe('Landscape');
    expect(flowOrientationForAspectRatio('1:1')).toBe('Square');
    expect(flowOrientationForAspectRatio('9:16')).toBe('Portrait');
    expect(flowOrientationForAspectRatio('3:4')).toBe('Portrait');
  });

  it('does not mistake Nano Banana 2 Lite for Nano Banana 2', () => {
    expect(flowConfigurationHasExactModel('🍌 Nano Banana 2 crop_square x1', 'Nano Banana 2')).toBe(true);
    expect(flowConfigurationHasExactModel('🍌 Nano Banana 2 Lite crop_square x1', 'Nano Banana 2')).toBe(false);
    expect(flowConfigurationHasExactModel('🍌 Nano Banana Pro crop_square x1', 'Nano Banana Pro')).toBe(true);
  });

  it('renames through the always-editable project title used by the current Flow UI', async () => {
    vi.useFakeTimers();
    const projectTitle = { rectangle: { x: 110, y: 20, width: 240, height: 40 }, text: 'Sep 09 - 15:30' };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ url: 'https://flow.google.com/project/new', projectTitleInput: projectTitle, tabs: [], menuItems: [], images: [] })
      .mockResolvedValueOnce({
        url: 'https://flow.google.com/project/new',
        projectTitleInput: { ...projectTitle, text: 'nhanvat ai' },
        tabs: [], menuItems: [], images: []
      });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = renameGoogleFlowProject(
      { executeJavaScript, insertText, sendInputEvent } as unknown as WebContents,
      'nhanvat ai',
      Date.now() + 5_000
    );

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toBe(true);
    expect(insertText).toHaveBeenCalledWith('nhanvat ai');
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 230, y: 40, button: 'left', clickCount: 1
    });
  });

  it('exits the Vietnamese Agent UI, configures Image x1, and returns only a new result URL', async () => {
    vi.useFakeTimers();
    const input = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 260, height: 40 };
    const agentClose = { x: 1220, y: 80, width: 32, height: 32 };
    const agentToggle = { x: 860, y: 805, width: 90, height: 32 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldImage = { rectangle: { x: 10, y: 10, width: 400, height: 300 }, src: 'https://flow-content.google/image/old' };
    const newImage = { rectangle: { x: 420, y: 10, width: 400, height: 300 }, src: 'https://flow-content.google/image/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Hình ảnh', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: 'crop_square 1:1', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: 'x1', selected: true }
    ];
    const editorState = {
      url: 'https://labs.google/fx/tools/flow/project/example', input,
      configButton: { rectangle: config, text: 'Video 720p 8s x2' },
      tabs: [], menuItems: [], images: [oldImage]
    };
    const panelState = {
      ...editorState,
      configButton: { rectangle: config, text: 'Nano Banana 2 Landscape x1' },
      tabs: selectedTabs
    };
    const agentSettingsState = {
      ...editorState,
      agentSettingsOpen: true,
      agentSettingsClose: agentClose,
      agentToggle: { rectangle: agentToggle, text: 'Tác nhân', selected: true }
    };
    const agentComposerState = {
      ...editorState,
      agentToggle: { rectangle: agentToggle, text: 'Tác nhân', selected: true }
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce(agentSettingsState)
      .mockResolvedValueOnce(agentComposerState)
      .mockResolvedValueOnce(editorState)
      // The pill can be visible one frame before the Image menu entries.
      .mockResolvedValueOnce(editorState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      // The live Create button is disabled and intentionally absent from the
      // probe until after text has been inserted into ProseMirror.
      .mockResolvedValueOnce(editorState)
      .mockResolvedValueOnce({ ...editorState, submit })
      .mockResolvedValueOnce({ ...editorState, submit, images: [oldImage, newImage] });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = automateGoogleFlowImageGeneration({
      executeJavaScript,
      insertText,
      sendInputEvent
    } as unknown as WebContents, {
      prompt: 'Create a fox', model: 'nano-banana-2', aspectRatio: '1:1', timeoutMs: 10_000
    });

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toBe(newImage.src);
    expect(insertText).toHaveBeenCalledWith('Create a fox');
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 1236, y: 96, button: 'left', clickCount: 1
    });
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 905, y: 821, button: 'left', clickCount: 1
    });
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 1120, y: 820, button: 'left', clickCount: 1
    });
  });

  it('uploads world style first and every character reference through Chromium in one ordered multiple-file selection', async () => {
    const input = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 260, height: 40 };
    const uploadLauncher = { x: 35, y: 810, width: 36, height: 36 };
    const uploadChoice = { x: 45, y: 690, width: 120, height: 36 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldImage = { rectangle: { x: 10, y: 10, width: 400, height: 300 }, src: 'https://flow-content.google/image/old' };
    const newImage = { rectangle: { x: 420, y: 10, width: 400, height: 300 }, src: 'https://flow-content.google/image/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Image', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: '16:9', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: 'x1', selected: true }
    ];
    const editorState = {
      url: 'https://labs.google/fx/tools/flow/project/example', input,
      configButton: { rectangle: config, text: 'Video 720p 8s x2' },
      uploadLauncher, tabs: [], menuItems: [], images: [oldImage]
    };
    const uploadMenuState = { ...editorState, uploadChoice };
    const panelState = {
      ...editorState,
      configButton: { rectangle: config, text: 'Nano Banana 2 Landscape x1' },
      tabs: selectedTabs
    };
    const states = [
      editorState, editorState, editorState, editorState,
      panelState, panelState, panelState, panelState,
      editorState,
      uploadMenuState,
      editorState,
      { ...editorState, submit }, { ...editorState, submit, images: [oldImage, newImage] }
    ];
    const executeJavaScript = vi.fn().mockImplementation(async (script: string) => {
      if (script.includes('input[type="file"]')) return false;
      return states.shift() ?? { ...editorState, submit, images: [oldImage, newImage] };
    });
    const insertText = vi.fn(async () => undefined);
    let attached = false;
    let interceptionEnabled = false;
    const messageListeners = new Set<(event: unknown, method: string, params: unknown, sessionId: string) => void>();
    const debuggerApi = {
      isAttached: vi.fn(() => attached),
      attach: vi.fn(() => { attached = true; }),
      detach: vi.fn(() => { attached = false; }),
      sendCommand: vi.fn(async (method: string, params?: { enabled?: boolean }) => {
        if (method === 'Page.setInterceptFileChooserDialog') interceptionEnabled = params?.enabled === true;
        return {};
      }),
      on: vi.fn((event: string, listener: (event: unknown, method: string, params: unknown, sessionId: string) => void) => {
        if (event === 'message') messageListeners.add(listener);
      }),
      removeListener: vi.fn((event: string, listener: (event: unknown, method: string, params: unknown, sessionId: string) => void) => {
        if (event === 'message') messageListeners.delete(listener);
      })
    };
    const sendInputEvent = vi.fn((event: { type: string; x?: number; y?: number }) => {
      if (event.type === 'mouseDown' && event.x === 105 && event.y === 708 && interceptionEnabled) {
        for (const listener of messageListeners) {
          listener({}, 'Page.fileChooserOpened', { backendNodeId: 73, mode: 'selectMultiple' }, '');
        }
      }
    });
    const operation = automateGoogleFlowImageGeneration({
      executeJavaScript,
      insertText,
      sendInputEvent,
      debugger: debuggerApi
    } as unknown as WebContents, {
      prompt: 'Create a storyboard frame', model: 'nano-banana-2', aspectRatio: '16:9', timeoutMs: 10_000,
      referenceImages: [
        { displayName: 'world-style.png', mimeType: 'image/png', base64: 'V09STEQ=' },
        { displayName: 'thok.jpeg', mimeType: 'image/jpeg', base64: 'VEhPSw==' },
        { displayName: 'buk.webp', mimeType: 'image/webp', base64: 'QlVL' }
      ]
    });

    await expect(operation).resolves.toBe(newImage.src);
    const setFilesCall = debuggerApi.sendCommand.mock.calls.find(([method]) => method === 'DOM.setFileInputFiles');
    expect(setFilesCall).toBeDefined();
    const files = (setFilesCall![1] as { files: string[]; backendNodeId: number }).files;
    expect((setFilesCall![1] as { backendNodeId: number }).backendNodeId).toBe(73);
    expect(files.map((file) => file.replace(/\\/g, '/').split('/').at(-1))).toEqual([
      '01-world-style.png',
      '02-thok.jpg',
      '03-buk.webp'
    ]);
    expect(existsSync(dirname(files[0]!))).toBe(false);
    expect(debuggerApi.attach).toHaveBeenCalledWith('1.3');
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
    const mouseDownEvents = sendInputEvent.mock.calls.map(([event]) => event)
      .filter((event) => event.type === 'mouseDown');
    expect(mouseDownEvents.filter((event) => event.x === 53 && event.y === 828)).toHaveLength(1);
    expect(mouseDownEvents.filter((event) => event.x === 105 && event.y === 708)).toHaveLength(1);
    expect(insertText).toHaveBeenCalledWith('Create a storyboard frame');
  }, 15_000);
});
