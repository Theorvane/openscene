import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That CI checks the mobile app at all.
 *
 * "Two Surfaces, One Core" in AGENTS.md requires the mobile typecheck on every
 * change that touches the app, and nothing enforced it: the workflow installed
 * only the root dependencies, so `mobile/` was never built and never checked.
 *
 * It showed up as something else entirely. The tests that cover mobile rules
 * import those modules, esbuild reads `mobile/tsconfig.json` to transform them,
 * that file extends `expo/tsconfig.base`, and with no mobile install the
 * transform failed before any assertion ran — a green suite locally and three
 * files failing on a tsconfig in CI.
 */

describe('the release pipeline', () => {
  it('publishes to Play only after everything that can fail has passed', async () => {
    // The two store jobs are not equally reversible. The iOS job uploads a
    // build and submits nothing; the Android job goes live to every user. Run
    // in parallel, an iOS failure after Play had already published left the
    // release shipped and untagged, and the retry collided on `versionCode`.
    const release = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

    expect(release).toMatch(/google-play:\n(?:.*\n)*?\s+needs: \[check, build, app-store-connect\]/);
    // And the tag still waits for both, or a failed upload would be recorded as
    // a release that shipped.
    expect(release).toMatch(/release:\n\s+needs: \[check, build, app-store-connect, google-play\]/);
  });
});

describe('CI', () => {
  it('installs and typechecks the mobile app', async () => {
    const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

    expect(workflow).toMatch(/working-directory: mobile\n\s+run: npm ci/);
    expect(workflow).toMatch(/working-directory: mobile\n\s+run: npm run typecheck/);
    // The install has to come first, or the tests transform against a tsconfig
    // whose base is still missing.
    expect(workflow.indexOf('npm ci'), 'the mobile install must precede the tests').toBeLessThan(
      workflow.indexOf('npm test')
    );
    // A cache keyed on one lockfile restores a tree that does not match the
    // other, which is a failure that only appears when a dependency changes.
    expect(workflow).toContain('mobile/package-lock.json');
  });
});
