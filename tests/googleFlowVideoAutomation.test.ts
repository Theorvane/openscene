import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  automateGoogleFlowVideoGeneration,
  detectDownloadedMp4,
  validateGoogleFlowVideoAutomationInput
} from '../src/main/googleFlowVideoAutomation';
import { waitForGoogleFlowProjectEditor } from '../src/main/googleFlowImageAutomation';

const FIRST_FRAME = { displayName: 'first.png', mimeType: 'image/png', base64: 'RklSU1Q=' } as const;
const LAST_FRAME = { displayName: 'last.png', mimeType: 'image/png', base64: 'TEFTVA==' } as const;

afterEach(() => vi.useRealTimers());

describe('Google Flow browser video automation', () => {
  it('waits for delayed project cards and reuses the matching project instead of creating a duplicate', async () => {
    vi.useFakeTimers();
    const newProject = { x: 20, y: 200, width: 240, height: 120 };
    const existingProject = { x: 300, y: 200, width: 240, height: 120 };
    const home = { url: 'https://flow.google.com/', newProject, projectCandidates: [], tabs: [], menuItems: [] };
    const matchingHome = {
      ...home,
      projectCandidates: [{
        rectangle: existingProject,
        text: 'nhanvat ai Chinh sua tieu de du an Xoa du an',
        href: 'https://flow.google.com/project/existing'
      }]
    };
    const editor = {
      url: 'https://flow.google.com/project/existing',
      input: { x: 20, y: 700, width: 300, height: 50 },
      configButton: { rectangle: { x: 20, y: 800, width: 300, height: 40 }, text: 'Video 720p 8s x1' },
      tabs: [], menuItems: []
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce(home)
      // Lookup of the remembered project URL. This is empty on a first run.
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(matchingHome)
      .mockResolvedValueOnce(editor);
    const loadURL = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = waitForGoogleFlowProjectEditor(
      { executeJavaScript, loadURL, sendInputEvent } as unknown as WebContents,
      Date.now() + 10_000,
      'nhanvat ai'
    );

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ createdProject: false, state: editor });
    expect(loadURL).toHaveBeenCalledWith('https://flow.google.com/project/existing');
    expect(sendInputEvent).not.toHaveBeenCalledWith({
      type: 'mouseDown', x: 420, y: 260, button: 'left', clickCount: 1
    });
    expect(sendInputEvent).not.toHaveBeenCalledWith({
      type: 'mouseDown', x: 140, y: 260, button: 'left', clickCount: 1
    });
  });

  it('reopens a remembered Flow project URL without touching New project', async () => {
    vi.useFakeTimers();
    const home = {
      url: 'https://flow.google.com/',
      newProject: { x: 20, y: 200, width: 240, height: 120 },
      projectCandidates: [], tabs: [], menuItems: []
    };
    const editor = {
      url: 'https://flow.google.com/project/remembered',
      input: { x: 20, y: 700, width: 300, height: 50 },
      configButton: { rectangle: { x: 20, y: 800, width: 300, height: 40 }, text: 'Video 720p 8s x1' },
      tabs: [], menuItems: []
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce('https://flow.google.com/project/remembered')
      .mockResolvedValueOnce(editor);
    const loadURL = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = waitForGoogleFlowProjectEditor(
      { executeJavaScript, loadURL, sendInputEvent } as unknown as WebContents,
      Date.now() + 10_000,
      'nhanvat ai'
    );

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ createdProject: false, state: editor });
    expect(loadURL).toHaveBeenCalledWith('https://flow.google.com/project/remembered');
    expect(sendInputEvent).not.toHaveBeenCalled();
  });

  it('retries the exact project URL when Flow remains on the project list after the first navigation', async () => {
    vi.useFakeTimers();
    const project = {
      rectangle: { x: 300, y: 200, width: 240, height: 120 },
      text: 'nhanvat ai Chinh sua tieu de du an Xoa du an',
      href: 'https://flow.google.com/project/existing'
    };
    const home = {
      url: 'https://flow.google.com/',
      projectCandidates: [project],
      tabs: [], menuItems: []
    };
    const editor = {
      url: project.href,
      input: { x: 20, y: 700, width: 300, height: 50 },
      configButton: { rectangle: { x: 20, y: 800, width: 300, height: 40 }, text: 'Video 720p 8s x1' },
      tabs: [], menuItems: []
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(editor);
    const loadURL = vi.fn(async () => undefined);
    const operation = waitForGoogleFlowProjectEditor(
      { executeJavaScript, loadURL, sendInputEvent: vi.fn() } as unknown as WebContents,
      Date.now() + 10_000,
      'nhanvat ai'
    );

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ createdProject: false, state: editor });
    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(loadURL).toHaveBeenNthCalledWith(1, project.href);
    expect(loadURL).toHaveBeenNthCalledWith(2, project.href);
  });

  it('recognizes MP4 family signatures instead of trusting a filename or MIME header', () => {
    expect(detectDownloadedMp4(Uint8Array.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d
    ]))).toBe(true);
    expect(detectDownloadedMp4(Uint8Array.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32
    ]))).toBe(true);
    expect(detectDownloadedMp4(new TextEncoder().encode('<html>sign in</html>'))).toBe(false);
  });

  it('accepts current Omni and Veo Flow controls', () => {
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'text_to_video', aspectRatio: '9:16', durationSeconds: 10
    })).not.toThrow();
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'start_end', aspectRatio: '16:9', durationSeconds: 8,
      referenceImage: FIRST_FRAME, lastFrame: LAST_FRAME
    })).not.toThrow();
  });

  it('rejects controls the visible Flow video product cannot faithfully execute', () => {
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-fast', operation: 'text_to_video', aspectRatio: '16:9', durationSeconds: 6
    })).toThrow(/exposes 8 second/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'text_to_video', aspectRatio: '1:1', durationSeconds: 4
    })).toThrow(/only 16:9 or 9:16/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'video_extend', aspectRatio: '16:9', durationSeconds: 4
    })).toThrow(/does not support video_extend/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'start_end', aspectRatio: '16:9', durationSeconds: 8,
      referenceImage: FIRST_FRAME
    })).toThrow(/requires a last frame/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'reference_to_video', aspectRatio: '16:9', durationSeconds: 8,
      referenceImages: []
    })).toThrow(/at least one component image/);
  });

  it('configures an exact Veo model, fills the prompt, submits, and returns only a new video URL', async () => {
    vi.useFakeTimers();
    const input = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 300, height: 40 };
    const agentToggle = { x: 860, y: 805, width: 90, height: 32 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldVideo = { rectangle: { x: 10, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/old' };
    const newVideo = { rectangle: { x: 420, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Video', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: 'Frames', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: '16:9', selected: true },
      { rectangle: { x: 4, y: 4, width: 20, height: 20 }, text: 'x1', selected: true }
    ];
    const state = {
      url: 'https://flow.google.com/project/example', input,
      configButton: { rectangle: config, text: 'Veo 3.1 - Quality Video 720p 8 seconds x1' },
      tabs: selectedTabs, menuItems: [], videos: [oldVideo]
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({
        ...state,
        agentToggle: { rectangle: agentToggle, text: 'Tác nhân', selected: true }
      })
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ ...state, submit })
      .mockResolvedValueOnce({ ...state, submit, videos: [oldVideo, newVideo] });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = automateGoogleFlowVideoGeneration({
      executeJavaScript, insertText, sendInputEvent
    } as unknown as WebContents, {
      prompt: 'Create a dawn aerial shot', model: 'veo-3.1-quality', operation: 'text_to_video',
      aspectRatio: '16:9', durationSeconds: 8, timeoutMs: 10_000
    });

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toBe(newVideo.src);
    expect(insertText).toHaveBeenCalledWith('Create a dawn aerial shot');
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 905, y: 821, button: 'left', clickCount: 1
    });
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 1120, y: 820, button: 'left', clickCount: 1
    });
  });

  it('assigns Start and End frames through separate Chromium file choosers', async () => {
    const promptInput = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 300, height: 40 };
    const start = { x: 100, y: 600, width: 100, height: 40 };
    const end = { x: 250, y: 600, width: 100, height: 40 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldVideo = { rectangle: { x: 10, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/old' };
    const newVideo = { rectangle: { x: 420, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Video', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: 'Frames', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: '16:9', selected: true },
      { rectangle: { x: 4, y: 4, width: 20, height: 20 }, text: 'x1', selected: true },
      { rectangle: start, text: 'Start' },
      { rectangle: end, text: 'End' }
    ];
    const state = {
      url: 'https://flow.google.com/project/example', input: promptInput,
      configButton: { rectangle: config, text: 'Veo 3.1 - Quality Video 720p 8 seconds x1' },
      tabs: selectedTabs, menuItems: [], videos: [oldVideo]
    };
    const states = [
      state, state, state, state, state, state,
      state, state, state, { ...state, submit }, { ...state, submit, videos: [oldVideo, newVideo] }
    ];
    const executeJavaScript = vi.fn().mockImplementation(async (script: string) => {
      if (script.includes('input[type="file"]')) return false;
      return states.shift() ?? { ...state, submit, videos: [oldVideo, newVideo] };
    });
    let attached = false;
    let interceptionEnabled = false;
    let chooserIndex = 0;
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
      if (event.type !== 'mouseDown' || !interceptionEnabled) return;
      if ((event.x === 150 && event.y === 620) || (event.x === 300 && event.y === 620)) {
        chooserIndex += 1;
        for (const listener of messageListeners) {
          listener({}, 'Page.fileChooserOpened', { backendNodeId: 100 + chooserIndex, mode: 'selectSingle' }, '');
        }
      }
    });
    const operation = automateGoogleFlowVideoGeneration({
      executeJavaScript,
      insertText: vi.fn(async () => undefined),
      sendInputEvent,
      debugger: debuggerApi
    } as unknown as WebContents, {
      prompt: 'Move between approved endpoints', model: 'veo-3.1-quality', operation: 'start_end',
      aspectRatio: '16:9', durationSeconds: 8, timeoutMs: 10_000,
      referenceImage: FIRST_FRAME, lastFrame: LAST_FRAME
    });

    await expect(operation).resolves.toBe(newVideo.src);
    const setFileCalls = debuggerApi.sendCommand.mock.calls
      .filter(([method]) => method === 'DOM.setFileInputFiles');
    expect(setFileCalls).toHaveLength(2);
    expect(setFileCalls.map(([, params]) => (params as { backendNodeId: number }).backendNodeId)).toEqual([101, 102]);
    expect(setFileCalls.map(([, params]) => ((params as { files: string[] }).files[0] ?? '').replace(/\\/g, '/').split('/').at(-1)))
      .toEqual(['01-first.png', '01-last.png']);
    expect(debuggerApi.attach).toHaveBeenCalledTimes(2);
    expect(debuggerApi.detach).toHaveBeenCalledTimes(2);
  }, 15_000);
});
