import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareExportOutputPath, validateExportOutput } from '../src/main/exportOutputFiles';
import { createSymlinkOrSkip } from './helpers/symlinkCapability';

describe('export output containment', () => {
  it('creates only generated MP4 paths beneath an absolute app-owned root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'export-output-'));
    const root = join(parent, 'exports');

    const outputPath = await prepareExportOutputPath(root, 'export_01');

    expect(basename(outputPath)).toBe('export_01.mp4');
    await expect(prepareExportOutputPath('relative/exports', 'export_02')).rejects.toThrow('not safe');
    await expect(prepareExportOutputPath(root, '../escape')).rejects.toThrow('not safe');
  });

  it('rejects a symlink in place of a completed output', async ({ skip }) => {
    const parent = await mkdtemp(join(tmpdir(), 'export-output-'));
    const root = join(parent, 'exports');
    const outputPath = await prepareExportOutputPath(root, 'export_01');
    const outsidePath = join(parent, 'outside.mp4');
    await writeFile(outsidePath, 'outside');
    if (!(await createSymlinkOrSkip(outsidePath, outputPath, skip))) return;

    await expect(validateExportOutput(root, outputPath)).rejects.toThrow();
  });

  it('rejects a symlink in place of the configured export root', async ({ skip }) => {
    const parent = await mkdtemp(join(tmpdir(), 'export-output-'));
    const actualRoot = join(parent, 'actual-exports');
    const linkedRoot = join(parent, 'exports');
    await mkdir(actualRoot);
    if (!(await createSymlinkOrSkip(actualRoot, linkedRoot, skip, 'dir'))) return;

    await expect(prepareExportOutputPath(linkedRoot, 'export_01')).rejects.toThrow('root');
  });
});
