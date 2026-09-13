import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeExportSubtitleSidecar } from '../src/main/exportOutputFiles';

describe('subtitle output containment', () => {
  it('writes only a generated UTF-8 filename and never overwrites an existing output', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'subtitle-output-'));
    const root = join(parent, 'exports');
    const sidecar = {
      format: 'srt', extension: 'srt', mimeType: 'application/x-subrip', cueCount: 1,
      contents: '1\n00:00:00,000 --> 00:00:01,000\nXin chào\n'
    } as const;
    const written = await writeExportSubtitleSidecar(root, 'export_01', sidecar);
    expect(written.fileName).toBe('export_01.srt');
    expect(await readFile(written.outputPath, 'utf8')).toBe(sidecar.contents);
    await expect(writeExportSubtitleSidecar(root, 'export_01', { ...sidecar, contents: 'replacement' })).rejects.toThrow();
    expect(await readFile(written.outputPath, 'utf8')).toBe(sidecar.contents);
    await expect(writeExportSubtitleSidecar(root, '../escape', sidecar)).rejects.toThrow('not safe');
  });
});
