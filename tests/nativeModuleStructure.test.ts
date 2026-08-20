import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * A cheap structural check on the native sources.
 *
 * There is no Swift compiler on the machine this suite runs on, so `ios-module`
 * in CI is the only thing that compiles the Swift — and a five-minute round trip
 * is a slow way to learn that a rebase left a struct unclosed. That happened:
 * merging two branches that both added a `Record` type produced
 * `struct DipInput { … struct TitleInput {`, which typechecks nowhere and was
 * found only after CI had run.
 *
 * This does not replace the compiler and cannot. It catches the one class of
 * damage a merge actually causes — a block that never closes — in milliseconds
 * rather than minutes.
 */

const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

/** Braces outside string literals and line comments. */
function braceDepth(source: string): { readonly final: number; readonly wentNegativeAt: number | null } {
  let depth = 0;
  let wentNegativeAt: number | null = null;
  source.split('\n').forEach((line, index) => {
    const code = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*/, '');
    depth += (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
    if (depth < 0 && wentNegativeAt === null) wentNegativeAt = index + 1;
  });
  return { final: depth, wentNegativeAt };
}

describe('the native sources are structurally whole', () => {
  it.each([
    ['modules/video-export/ios/VideoExportModule.swift'],
    ['modules/video-export/ios/VideoComposer.swift'],
    ['modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt']
  ])('every block in %s closes', async (path) => {
    const { final, wentNegativeAt } = braceDepth(await read(path));
    expect(wentNegativeAt).toBeNull();
    expect(final).toBe(0);
  });

  it('declares each Swift record type once', async () => {
    const swift = (await Promise.all([
      read('modules/video-export/ios/VideoExportModule.swift'),
      read('modules/video-export/ios/VideoComposer.swift')
    ])).join('\n');
    const declared = [...swift.matchAll(/^struct (\w+): Record \{/gm)].map(([, name]) => name);
    // A merge that duplicates a type compiles nowhere; a merge that drops one is
    // a field silently going missing.
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toContain('SegmentInput');
    expect(declared).toContain('ExportRequest');
  });
});

/**
 * An export must not collide with the one before it.
 *
 * Both modules named their output after the clock — iOS in whole seconds, which
 * meant two exports finishing in the same second produced the same path.
 * `AVAssetExportSession` does not overwrite; it fails with "Cannot Save", which
 * reads like a permissions problem and is not one. The first CI run of the
 * composer tests found it, because those export four times in a few seconds.
 * A phone finds it by exporting twice quickly.
 */
describe('the exported file name', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('is unique on iOS, not merely a clock reading', async () => {
    const swift = await read('modules/video-export/ios/VideoComposer.swift');
    expect(swift).toMatch(/openvideo-export-[^\n]*UUID\(\)/);
  });

  it('is unique on Android for the same reason', async () => {
    const kotlin = await read(
      'modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    expect(kotlin).toMatch(/openvideo-export-[\s\S]{0,80}UUID\.randomUUID/);
  });
});
