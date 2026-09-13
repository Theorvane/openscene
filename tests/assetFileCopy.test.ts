import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { copyAssetFile } from '../src/main/assetFileCopy';

describe('asset file copy', () => {
  it('flushes a generated WAV through its writable handle before read-only verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-result-copy-'));
    const sourcePath = join(directory, 'generated voice.wav');
    const destinationDirectory = join(directory, 'project with spaces', 'assets', 'voice');
    const destinationPath = join(destinationDirectory, 'original.wav');
    const sourceBytes = Buffer.from('RIFF-generated-voice');
    try {
      await writeFile(sourcePath, sourceBytes);
      await mkdir(destinationDirectory, { recursive: true });

      await expect(copyAssetFile({
        sourcePath,
        destinationDirectory,
        destinationPath,
        maximumBytes: 1024
      })).resolves.toBe(sourceBytes.byteLength);
      await expect(readFile(destinationPath)).resolves.toEqual(sourceBytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
