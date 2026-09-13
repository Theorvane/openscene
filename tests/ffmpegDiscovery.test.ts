import { chmod, mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';

async function executable(path: string): Promise<void> {
  await writeFile(path, '#!/bin/sh\nexit 0\n');
  await chmod(path, 0o700);
}

describe('FFmpeg discovery', () => {
  it('uses a configured absolute executable and resolves symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ffmpeg-discovery-'));
    const target = join(root, 'ffmpeg-real');
    const configured = process.platform === 'win32' ? target : join(root, 'ffmpeg-link');
    await executable(target);
    // Ordinary Windows developer accounts cannot create symlinks. The same
    // configured-path contract is still exercised there; macOS/Linux CI also
    // verifies that a link is canonicalized to its target.
    if (process.platform !== 'win32') await symlink(target, configured);

    await expect(discoverFfmpeg({ environment: { VIDEO_TOOL_FFMPEG_PATH: configured }, platform: 'darwin' })).resolves.toEqual({
      kind: 'configured',
      executablePath: await realpath(target)
    });
  });

  it('searches only absolute PATH entries for a system executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ffmpeg-discovery-'));
    const binaryDirectory = join(root, 'bin');
    await mkdir(binaryDirectory);
    const binaryPath = join(binaryDirectory, 'ffmpeg');
    await executable(binaryPath);

    await expect(
      discoverFfmpeg({ environment: { PATH: `relative-bin${delimiter}${binaryDirectory}` }, platform: 'darwin' })
    ).resolves.toEqual({ kind: 'system', executablePath: await realpath(binaryPath) });
  });

  it('fails closed when a configured path is relative instead of falling back to PATH', async () => {
    await expect(
      discoverFfmpeg({ environment: { VIDEO_TOOL_FFMPEG_PATH: 'ffmpeg', PATH: '/usr/bin' }, platform: 'darwin' })
    ).resolves.toEqual({ kind: 'unavailable', reason: 'Configured FFmpeg path must be absolute.' });
  });
});
