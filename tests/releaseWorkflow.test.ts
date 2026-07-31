import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const builderConfig = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  readonly version: string;
  readonly scripts: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly author: { readonly name?: string; readonly email?: string };
};

describe('release workflow', () => {
  it('releases only from main, and only when the version is not already tagged', () => {
    expect(workflow).toContain('branches: [main]');
    // The version is the release decision: a second push to main must not
    // publish again, so every later step is gated on the tag being absent.
    expect(workflow).toContain('if git rev-parse -q --verify "refs/tags/${TAG}"');
    expect(workflow).toContain("already-released=true");
    // Packaging, store distribution, and publishing are separate jobs, so each
    // has to be gated too; a job without the guard would run on any push to main.
    expect(workflow).toContain("if: needs.check.outputs.already-released == 'false'");
    const jobGates = workflow.match(/if: needs\.check\.outputs\.already-released == 'false'/g) ?? [];
    expect(jobGates.length).toBe(4);
  });

  it('verifies the exact commit it packages', () => {
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run build');
  });

  it('packages each platform on its own runner', () => {
    for (const os of ['macos-latest', 'windows-latest', 'ubuntu-latest']) {
      expect(workflow).toContain(`os: ${os}`);
    }
    expect(workflow).toContain('npx electron-builder --${{ matrix.platform }} --publish never');
    // One platform failing must not silently drop its artifacts from a release
    // that still publishes; the release job depends on the whole matrix.
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).toContain('needs: [check, build]');
    expect(workflow).toContain('if-no-files-found: error');
  });

  it('tags, branches, and publishes the artifacts it built', () => {
    expect(workflow).toContain('git tag -a "$TAG"');
    expect(workflow).toContain('git push origin "refs/tags/$TAG"');
    expect(workflow).toContain('git push origin "HEAD:refs/heads/release/$TAG"');
    expect(workflow).toContain('gh release create "$TAG"');
    expect(workflow).toContain('--generate-notes');
    expect(workflow).toContain('artifacts/*');
  });

  it('signs, hardens, and notarizes macOS rather than shipping what Gatekeeper calls damaged', () => {
    // An unsigned app plus the download quarantine attribute is what produced
    // "OpenScene is damaged and can't be opened" on v0.1.0.
    expect(builderConfig).toContain('hardenedRuntime: true');
    expect(builderConfig).toContain('notarize: true');
    expect(builderConfig).toContain('entitlements: build/entitlements.mac.plist');
    expect(builderConfig).not.toContain('identity: null');
  });

  it('fails the macOS build rather than publishing one that was silently left unnotarized', () => {
    // electron-builder logs "skipped macOS notarization" and exits 0 when the
    // credentials are absent. Without this gate a missing secret ships a build
    // Gatekeeper rejects, under release notes saying it opens normally.
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).toContain('spctl -a -vvv -t exec');
    expect(workflow).toContain('codesign --verify --deep --strict');
  });

  it('describes each platform truthfully instead of calling every build unsigned', () => {
    expect(workflow).toMatch(/macOS builds are signed[^"]*notarized/);
    expect(workflow).toMatch(/Windows builds are unsigned/);
    expect(workflow).toMatch(/SmartScreen/);
  });

  it('pins actions to immutable commit SHAs', () => {
    const uses = workflow.match(/uses: [^\n]+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      // Reusable workflows in this repository are versioned by the exact
      // commit promoted to main, so they intentionally have a local path
      // rather than an external action ref.
      if (use.includes('uses: ./.github/workflows/')) continue;
      expect(use).toMatch(/@[0-9a-f]{40}/);
    }
  });

  it('distributes mobile stores only as part of a new main release', () => {
    expect(workflow).toContain('uses: ./.github/workflows/ios-app-store-connect.yml');
    expect(workflow).toContain('uses: ./.github/workflows/android-google-play.yml');
    expect(workflow).toContain('track: production');
    expect(workflow).toContain('release_status: completed');
    expect(workflow).toContain('needs: [check, build, app-store-connect, google-play]');
  });

  it('keeps packaging able to run locally with the same inputs', () => {
    expect(packageJson.scripts.package).toBe('npm run build && electron-builder --publish never');
    expect(packageJson.devDependencies['electron-builder']).toBeDefined();
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    // electron-vite writes the app into out/; the package must carry it.
    expect(builderConfig).toContain('out/**');
    expect(builderConfig).toContain('productName: OpenScene');
  });

  it('lets the release job be re-run without aborting on what it already published', () => {
    // The check job's tag guard only covers a fresh push to main. Re-running the
    // release job alone, after a flaky upload, replays a tag push and a release
    // creation that have already happened; both must no-op rather than error.
    expect(workflow).toContain('git ls-remote --exit-code --tags origin "refs/tags/$TAG"');
    expect(workflow).toContain('gh release view "$TAG"');
    expect(workflow).toContain('gh release upload "$TAG" artifacts/* --clobber');
  });

  it('pins every dependency instead of floating on latest', () => {
    // The same reproducibility hole this workflow closed for electron: a "latest"
    // float lets two packaging runs of one commit resolve different trees.
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const floating = Object.entries(allDeps)
      .filter(([, range]) => range === 'latest' || range === '*')
      .map(([name]) => name);
    expect(floating).toEqual([]);
  });

  it('verifies the release on the same toolchain CI verifies every PR on', () => {
    // The suite drives a real FFmpeg binary in the export and import paths, so a
    // release gate that runs it without one fails on its environment rather than
    // on the commit. This caught v0.1.0: `verify` passed on the promotion PR and
    // the release job then failed on five FFmpeg tests, because only ci.yml
    // installed it. Pin them together so the next drift fails in CI, not once per
    // release.
    const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const toolchain = /brew install ([^\n]+)/;
    const ciTools = ci.match(toolchain)?.[1]?.trim();
    expect(ciTools).toBeDefined();
    expect(workflow).toContain(`brew install ${ciTools ?? ''}`);
  });

  it('publishes the update metadata the in-app updater reads, not only the installers', () => {
    // electron-updater looks for latest.yml / latest-mac.yml / latest-linux.yml
    // in the release. Ship the installers without them and the updater cannot
    // see that a release happened at all — it fails silently, on the one code
    // path no CI run exercises.
    expect(builderConfig).toContain('publish:');
    expect(builderConfig).toContain('provider: github');
    // Narrow on purpose: dist/*.yml also matches electron-builder's
    // builder-debug.yml, which shipped as a public asset on v0.1.0.
    expect(workflow).toContain('dist/latest*.yml');
    expect(workflow).not.toContain('dist/*.yml');
    // Blockmaps are what make a Windows update a delta rather than a full
    // re-download; without them electron-updater falls back to the whole file.
    expect(workflow).toContain('dist/*.blockmap');
  });

  it('carries the maintainer identity the Linux packages require', () => {
    // fpm refuses to build a deb without a maintainer email, and the failure is
    // a packaging-time error, not a test failure — so it only ever surfaces on
    // the Linux runner during a release. A plain "Theorvane" string is not
    // enough; the object form with an email is.
    const author = packageJson.author;
    expect(typeof author).toBe('object');
    expect(author.email).toMatch(/@/);
  });

  it('names the Linux artifacts after the product rather than the internal package', () => {
    // Every default here comes from package.json's `name`, which is
    // video-window-recorder — so an install would read that while the app,
    // the menu bar, and the release all say OpenScene.
    expect(builderConfig).toContain('executableName: openscene');
    expect(builderConfig).toContain('packageName: openscene');
    expect(builderConfig).toMatch(/artifactName: openscene-\$\{version\}/);
  });

  it('declares a target for every platform the workflow builds', () => {
    for (const platform of ['mac:', 'win:', 'linux:']) {
      expect(builderConfig).toContain(platform);
    }
    for (const target of ['dmg', 'nsis', 'AppImage', 'deb']) {
      expect(builderConfig).toContain(`target: ${target}`);
    }
  });
});
