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
    ['modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt']
  ])('every block in %s closes', async (path) => {
    const { final, wentNegativeAt } = braceDepth(await read(path));
    expect(wentNegativeAt).toBeNull();
    expect(final).toBe(0);
  });

  it('declares each Swift record type once', async () => {
    const swift = await read('modules/video-export/ios/VideoExportModule.swift');
    const declared = [...swift.matchAll(/^struct (\w+): Record \{/gm)].map(([, name]) => name);
    // A merge that duplicates a type compiles nowhere; a merge that drops one is
    // a field silently going missing.
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toContain('SegmentInput');
    expect(declared).toContain('ExportRequest');
  });
});
