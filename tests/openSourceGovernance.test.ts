import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_URL = new URL('../.github/workflows/ci.yml', import.meta.url);
const CONTRIBUTING_URL = new URL('../CONTRIBUTING.md', import.meta.url);

describe('open-source CI contract', () => {
  it('installs FFmpeg before media tests and verifies pushes to dev and main plus pull requests', async () => {
    const workflow = await readFile(CI_WORKFLOW_URL, 'utf8');

    expect(workflow).toMatch(/branches:\s*\[dev, main\]/);
    expect(workflow).toMatch(/^\s*pull_request:\s*$/m);
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents:\s+read\s*$/m);

    const ffmpegInstallIndex = workflow.indexOf('brew install ffmpeg');
    const testIndex = workflow.indexOf('npm test');

    expect(ffmpegInstallIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(-1);
    expect(ffmpegInstallIndex).toBeLessThan(testIndex);
  });

  it('requires issue-numbered branches from dev and pull requests to dev', async () => {
    const contributing = await readFile(CONTRIBUTING_URL, 'utf8');

    expect(contributing).toContain('git switch -c feat/123-short-description');
    expect(contributing).toContain('pull request **to `dev`**');
  });
});
