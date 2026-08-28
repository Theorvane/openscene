import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That a finished export is read back on every surface.
 *
 * The rule lives in the shared core and is tested there. What this pins is the
 * wiring, because the defect being guarded against is not a wrong comparison —
 * it is nobody performing one. A surface that renders a file and reports
 * success without measuring it is exactly the state this came from, and it
 * would pass every other test in the suite.
 */

const readRepo = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the desktop', () => {
  it('measures the file before the job is called complete', async () => {
    const service = await readRepo('src/main/exportIpcService.ts');
    const measured = service.indexOf('measureExportedFile');
    const completed = service.indexOf('markCompleted');
    expect(measured).toBeGreaterThan(-1);
    expect(measured).toBeLessThan(completed);
    expect(service).toContain('reviewExport(');
  });

  it('promises what it asked FFmpeg for, not what the timeline looked like', async () => {
    const service = await readRepo('src/main/exportIpcService.ts');
    // The frame and rate the graph was compiled with, and the sound the graph
    // actually carries — a timeline can hold an audio clip whose file turned
    // out to have nothing in it.
    expect(service).toContain('hasSound: compiled.hasSound');
    expect(service).toContain('durationMs: compiled.durationMs');
  });
});

describe('the phone', () => {
  it('measures the file before reporting the export', async () => {
    const bridge = await readRepo('mobile/src/lib/exportComposition.ts');
    expect(bridge).toContain('VideoExport.describeVideo');
    expect(bridge).toContain('reviewExport(');
    expect(bridge).toMatch(/return \{ ok: true, uri: result\.uri, review \}/);
  });

  it('says so when the saved file does not match the cut', async () => {
    const app = await readRepo('mobile/App.tsx');
    expect(app).toContain('exportReviewSummary');
    expect(app).toContain('does not match the cut');
  });

  it('has a measurement on both native modules', async () => {
    const android = await readRepo(
      'mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    const ios = await readRepo('mobile/modules/video-export/ios/VideoExportModule.swift');
    expect(android).toContain('AsyncFunction("describeVideo")');
    expect(ios).toContain('AsyncFunction("describeVideo")');
    // Both report the stored size after rotation, or every upright phone
    // export would be reported as the wrong shape.
    expect(android).toContain('METADATA_KEY_VIDEO_ROTATION');
    expect(await readRepo('mobile/modules/video-export/ios/VideoFacts.swift')).toContain('preferredTransform');
  });

  it('treats a build that cannot measure as unchecked rather than as a pass', async () => {
    const bridge = await readRepo('mobile/modules/video-export/index.ts');
    expect(bridge).toMatch(/typeof nativeModule\.describeVideo !== 'function'\) return null/);
  });
});
