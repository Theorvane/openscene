import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FfmpegExportProcessError, startFfmpegExportProcess } from '../src/main/ffmpegExportProcess';
import type { SpawnFfmpegProcess } from '../src/main/ffmpegExportProcess';

const FAKE_FFMPEG = `
const mode = process.argv[2];
if (mode === 'complete') {
  require('node:fs').writeSync(1, 'out_time_us=500000\\nprogress=continue\\n');
} else if (mode === 'wait') {
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
}
`;

describe('FFmpeg export process', () => {
  it('spawns without a shell and reports machine-readable progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ffmpeg-process-'));
    const scriptPath = join(root, 'fake-ffmpeg.cjs');
    await writeFile(scriptPath, FAKE_FFMPEG);
    const updates: number[] = [];
    let shellOption: boolean | string | undefined;
    const spawnProcess: SpawnFfmpegProcess = (file, args, options) => {
      shellOption = options.shell;
      return spawn(file, args, options);
    };

    const execution = startFfmpegExportProcess({
      executablePath: process.execPath,
      args: [scriptPath, 'complete'],
      durationMs: 1_000,
      onProgress: (progress) => updates.push(progress.processedMs),
      spawnProcess
    });
    await execution.completion;

    expect(shellOption).toBe(false);
    expect(updates).toEqual([500]);
  });

  it('terminates a running process when cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ffmpeg-process-'));
    const scriptPath = join(root, 'fake-ffmpeg.cjs');
    await writeFile(scriptPath, FAKE_FFMPEG);
    const execution = startFfmpegExportProcess({
      executablePath: process.execPath,
      args: [scriptPath, 'wait'],
      durationMs: 1_000,
      onProgress: () => undefined
    });

    execution.cancel();

    await expect(execution.completion).rejects.toMatchObject({
      name: 'FfmpegExportProcessError',
      code: 'CANCELLED'
    } satisfies Partial<FfmpegExportProcessError>);
  });
});
