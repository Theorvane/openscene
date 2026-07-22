import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_URL = new URL('../.github/workflows/ci.yml', import.meta.url);

describe('open-source CI contract', () => {
  it('installs FFmpeg before media tests and verifies pushes to dev and main plus pull requests', async () => {
    const workflow = await readFile(CI_WORKFLOW_URL, 'utf8');

    expect(workflow).toMatch(/branches:\s*\[dev, main\]/);
    expect(workflow).toMatch(/^\s*pull_request:\s*$/m);

    const ffmpegInstallIndex = workflow.indexOf('brew install ffmpeg');
    const testIndex = workflow.indexOf('npm test');

    expect(ffmpegInstallIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(-1);
    expect(ffmpegInstallIndex).toBeLessThan(testIndex);
  });
});
