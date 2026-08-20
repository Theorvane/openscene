import { readFile, readlink } from 'node:fs/promises';

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

/**
 * Every workflow that claims to verify a commit, not just the one that was
 * fixed.
 *
 * The first version of this asserted `ci.yml` alone, and `release.yml` — which
 * runs its own verification with its own install steps — kept the identical
 * gap. It failed the 0.4.0 promotion on the same tsconfig, and before that it
 * had been passing 773 of 816 tests and calling the result a verified release.
 *
 * "The other workflow needs this too" is exactly what a person forgets, so the
 * list is the assertion.
 */
const VERIFYING_WORKFLOWS = ['ci.yml', 'release.yml'] as const;

describe.each(VERIFYING_WORKFLOWS)('%s', (workflow) => {
  const read = async () => readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');

  it('installs the mobile app before running the suite', async () => {
    const yaml = await read();
    expect(yaml).toMatch(/working-directory: mobile\n\s+run: npm ci/);
    // Or the tests transform against a tsconfig whose base is still missing.
    expect(yaml.indexOf('working-directory: mobile'), 'the mobile install must precede the tests').toBeLessThan(
      yaml.indexOf('npm test')
    );
  });

  it('typechecks the mobile app', async () => {
    // Required of every change that touches it — see "Two Surfaces, One Core"
    // in AGENTS.md — and a release gate must not verify less than a pull
    // request does.
    expect(await read()).toMatch(/working-directory: mobile\n\s+run: npm run typecheck/);
  });

  it('keys the dependency cache on both lockfiles', async () => {
    // Keyed on one, a mobile dependency change restores a tree that does not
    // match the install that follows it.
    expect(await read()).toContain('mobile/package-lock.json');
  });
});

/**
 * That the iOS signing step asks the profile what it is called.
 *
 * The 0.4.0 release failed to archive on
 * `No profile for team '5H9F8F82WT' matching 'macbook' found`. Not an expiry:
 * the certificate and the profile were rotated on one day and the variable
 * naming the profile still held a value from five weeks earlier, which was also
 * the date of the last release that worked. Two sources for one fact, and the
 * copy is the one nobody updates.
 */
describe('the iOS signing step', () => {
  const read = () => readFile(new URL('../.github/workflows/ios-app-store-connect.yml', import.meta.url), 'utf8');

  it('takes the profile name from the profile', async () => {
    const yaml = await read();
    expect(yaml).toContain('security cms -D -i "$PROFILE_PATH"');
    expect(yaml).toContain('plutil -extract Name raw');
    expect(yaml).toContain('PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME"');
    // The variable may still exist, but it must not be what the build signs
    // with — otherwise the drift simply comes back.
    expect(yaml).not.toContain('PROVISIONING_PROFILE_SPECIFIER="$APP_STORE_PROFILE_NAME"');
  });

  it('checks the profile covers this app before spending an archive on it', async () => {
    // A mismatch used to cost a pod install and a full archive before xcodebuild
    // mentioned it.
    const yaml = await read();
    expect(yaml).toContain('plutil -extract Entitlements.application-identifier raw');
    expect(yaml).toMatch(/::error::The provisioning profile is for/);
    // A wildcard profile is legitimate, so it is matched rather than refused.
    expect(yaml).toMatch(/"\$\{PROFILE_APP_ID%\\\*\}"\*\)/);
  });
});

/**
 * That the Swift is compiled by something.
 *
 * The iOS export module was changed twice without anything ever building it.
 * The suite is TypeScript, the Android module is compiled by its own Gradle
 * build, and Swift had no equivalent — so a green CI said nothing at all about
 * half the native code, and a review had to point that out rather than a check.
 */
describe('the iOS module', () => {
  const read = () => readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  it('is built on every pull request', async () => {
    const yaml = await read();
    expect(yaml).toContain('ios-module:');
    expect(yaml).toContain('npx expo prebuild --platform ios');
    expect(yaml).toMatch(/xcodebuild[\s\S]{0,400}build/);
  });

  it('builds without needing a signing identity', async () => {
    // Certificates and profiles belong to a release, not to "does this
    // compile" — requiring them would make this run only where the secrets
    // are, which is exactly where it is least useful.
    const yaml = await read();
    expect(yaml).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(yaml).not.toMatch(/ios-module:[\s\S]*?APPLE_DISTRIBUTION_CERTIFICATE/);
  });
});

describe('the iOS renderer', () => {
  const read = () => readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  it('is exported from and measured, not only compiled', async () => {
    // Compiling proves a line exists. Every rendering bug this project has had
    // was found by exporting a file and reading it back, and iOS was the one
    // renderer nothing could export from until its composition was lifted out
    // of the Expo module.
    const yaml = await read();
    expect(yaml).toContain('ios-export:');
    expect(yaml).toContain('swift test');
    expect(yaml).toContain('mobile/modules/video-export/composer-tests');
  });

  it('tests the file the app builds rather than a copy of it', async () => {
    // The package's source is a symlink to `ios/VideoComposer.swift`. A copy
    // would drift, and a drifting copy passing its tests is worse than no
    // tests: it says the renderer works when what works is the copy.
    const link = await readlink(new URL('../mobile/modules/video-export/composer-tests/Sources/VideoComposer/VideoComposer.swift', import.meta.url));
    expect(link).toContain('ios/VideoComposer.swift');
  });
});
