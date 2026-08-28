import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That the ceiling is actually in the way on both surfaces.
 *
 * The rule is tested where it lives. What this pins is that each place a job
 * reaches a provider goes through it — because a limit checked in one of three
 * places is not a limit, and the defect would look exactly like a working
 * feature until the month someone generated through the wrong screen.
 */

const readRepo = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the desktop', () => {
  it('checks the ceiling at every one of its generation seams', async () => {
    const jobs = await readRepo('src/main/aiJobManager.ts');
    const seams = [/createVideoGenerationJob/, /createImageGenerationJob/, /createSpeechGenerationJob/];
    for (const seam of seams) expect(jobs).toMatch(seam);
    // Three creators, three checks, three records.
    expect(jobs.match(/await refuseIfOverSpendCap\(/g)).toHaveLength(3);
    expect(jobs.match(/await recordSpend\(estimate\)/g)).toHaveLength(3);
  });

  it('records the charge where the request goes out, not where the job is queued', async () => {
    const jobs = await readRepo('src/main/aiJobManager.ts');
    // A job that never reached a provider — a missing key — cost nothing, and
    // charging a ceiling for it would lock someone out over nothing.
    for (const call of ['invokeCloudVideoProvider', 'invokeCloudImageProvider', 'invokeCloudSpeechProvider']) {
      const before = jobs.slice(0, jobs.indexOf(`await ${call}(`));
      expect(before.lastIndexOf('await recordSpend(estimate)')).toBeGreaterThan(before.lastIndexOf('apiKey is required'));
    }
  });

  it('lets the agent read the limit but never set it', async () => {
    const server = await readRepo('src/main/openVideoMcpServer.ts');
    expect(server).toContain('async getGenerationSpend()');
    // Raising your own ceiling is not having one.
    expect(server).not.toContain('setCap');
    expect(server).not.toContain('setGenerationSpendCap');
  });
});

describe('the phone', () => {
  it('checks the ceiling before a provider is called, on both of the seams it has', async () => {
    const images = await readRepo('mobile/src/screens/ImageScreen.tsx');
    const video = await readRepo('mobile/src/lib/videoGeneration.ts');
    for (const source of [images, video]) {
      expect(source).toContain('checkAgainstCap(');
      expect(source).toContain('recordCharge(');
    }
    // Speech is not generated on this surface yet, so there is no third seam
    // to guard — when there is, this test is where it will be noticed.
    const voice = await readRepo('mobile/src/screens/VoiceScreen.tsx');
    expect(voice).not.toContain('apiKey');
  });

  it('checks before spending the key, not after the charge', async () => {
    const video = await readRepo('mobile/src/lib/videoGeneration.ts');
    expect(video.indexOf('checkAgainstCap(')).toBeLessThan(video.indexOf('const apiKey = await readKey'));
  });

  it('keeps the ledger on disk, because a limit that forgets is not a limit', async () => {
    const ledger = await readRepo('mobile/src/lib/spendLedger.ts');
    expect(ledger).toContain('generation-spend.json');
    expect(ledger).toContain('@openvideo/shared/generationSpend');
  });

  it('lets the limit be set and removed from Settings', async () => {
    const settings = await readRepo('mobile/src/screens/SettingsScreen.tsx');
    expect(settings).toContain('setSpendCap(null)');
    expect(settings).toContain('describeSpend(');
  });
});
