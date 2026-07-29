import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const PACKAGE_SOURCE_URL = new URL('../package.json', import.meta.url);
const INDEX_HTML_SOURCE_URL = new URL('../index.html', import.meta.url);
const MAIN_INDEX_SOURCE_URL = new URL('../src/main/index.ts', import.meta.url);
const TIMELINE_EDITOR_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url);
const VIDEO_GENERATION_WORKSPACE_SOURCE_URL = new URL('../src/renderer/src/VideoGenerationWorkspace.tsx', import.meta.url);
const DESIGN_SOURCE_URL = new URL('../DESIGN.md', import.meta.url);
const THEME_SOURCE_URL = new URL('../src/renderer/src/theme.ts', import.meta.url);
const EDITOR_LAYOUT_SOURCE_URL = new URL('../src/renderer/src/editor/editorLayoutPreferences.ts', import.meta.url);
const EDITOR_SHORTCUTS_SOURCE_URL = new URL('../src/renderer/src/editor/editorShortcuts.ts', import.meta.url);
const ASSET_BIN_SOURCE_URL = new URL('../src/renderer/src/editor/AssetBin.tsx', import.meta.url);
const TIMELINE_CANVAS_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineCanvas.tsx', import.meta.url);
const PRELOAD_SOURCE_URL = new URL('../src/preload/index.ts', import.meta.url);
const CAPTURE_RECORDER_SOURCE_URL = new URL('../src/renderer/src/useCaptureRecorder.ts', import.meta.url);
const PROVIDER_SEAMS_SOURCE_URL = new URL('../src/shared/providerSeams.ts', import.meta.url);

describe('OpenVideo branding source contract', () => {
  it('Given visible application metadata and UI copy, When source files are read, Then they use OpenVideo branding', async () => {
    const [packageSource, indexHtmlSource, mainIndexSource, timelineEditorSource, videoGenWorkspaceSource, designSource] = await Promise.all([
      readFile(PACKAGE_SOURCE_URL, 'utf8'),
      readFile(INDEX_HTML_SOURCE_URL, 'utf8'),
      readFile(MAIN_INDEX_SOURCE_URL, 'utf8'),
      readFile(TIMELINE_EDITOR_SOURCE_URL, 'utf8'),
      readFile(VIDEO_GENERATION_WORKSPACE_SOURCE_URL, 'utf8'),
      readFile(DESIGN_SOURCE_URL, 'utf8')
    ]);

    expect(packageSource).toContain('"productName": "OpenVideo"');
    expect(packageSource).toContain('"description": "OpenVideo secure Electron MVP for selected-window preview and local WebM recording."');
    expect(indexHtmlSource).toContain('<title>OpenVideo</title>');
    // The name is a constant now, so the window title and the About panel and
    // app.setName() cannot drift apart.
    expect(mainIndexSource).toContain("const APP_NAME = 'OpenVideo'");
    expect(mainIndexSource).toContain('app.setName(APP_NAME)');
    expect(mainIndexSource).toContain('title: APP_NAME');
    expect(timelineEditorSource).toContain('<h1 id="timeline-editor-title">OpenVideo</h1>');
    // The studio headings dropped the "AI" prefix with the chat-style redesign.
    expect(videoGenWorkspaceSource).toContain('id="video-generation-title">Video Generation<');
    expect(designSource).toContain('# OpenVideo Design System');
    expect(designSource).toContain('The Edit workspace keeps `Local studio`, `OpenVideo`, and the `Timeline editor` subtitle as visually hidden region labels for accessibility;');
  });

  it('Given compatibility-sensitive contracts, When source files are read, Then the rebrand keeps persisted and bridge identifiers unchanged', async () => {
    const [designSource, themeSource, editorLayoutSource, editorShortcutsSource, assetBinSource, timelineCanvasSource, preloadSource, captureRecorderSource, providerSeamsSource] = await Promise.all([
      readFile(DESIGN_SOURCE_URL, 'utf8'),
      readFile(THEME_SOURCE_URL, 'utf8'),
      readFile(EDITOR_LAYOUT_SOURCE_URL, 'utf8'),
      readFile(EDITOR_SHORTCUTS_SOURCE_URL, 'utf8'),
      readFile(ASSET_BIN_SOURCE_URL, 'utf8'),
      readFile(TIMELINE_CANVAS_SOURCE_URL, 'utf8'),
      readFile(PRELOAD_SOURCE_URL, 'utf8'),
      readFile(CAPTURE_RECORDER_SOURCE_URL, 'utf8'),
      readFile(PROVIDER_SEAMS_SOURCE_URL, 'utf8')
    ]);

    expect(designSource).toContain('`window-loom-theme`');
    expect(themeSource).toContain("'window-loom-theme'");
    expect(editorLayoutSource).toContain("'window-loom-editor-layout'");
    expect(editorShortcutsSource).toContain("'window-loom-editor-shortcuts'");
    expect(assetBinSource).toContain("'application/x-window-loom-timeline'");
    expect(timelineCanvasSource).toContain("'application/x-window-loom-timeline'");
    expect(preloadSource).toContain("exposeInMainWorld('videoTool', videoTool)");
    expect(captureRecorderSource).toContain('window.videoTool');
    // Media generation is cloud-only; Ollama is the app's only local engine.
    expect(providerSeamsSource).toContain("'elevenlabs'");
    expect(providerSeamsSource).not.toContain("'local_qwen'");
    expect(providerSeamsSource).not.toContain("'local_video'");
  });
});
