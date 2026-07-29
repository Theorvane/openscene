import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const builderConfig = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  readonly version: string;
  readonly scripts: Record<string, string>;
  readonly devDependencies: Record<string, string>;
};

describe('release workflow', () => {
  it('releases only from main, and only when the version is not already tagged', () => {
    expect(workflow).toContain('branches: [main]');
    // The version is the release decision: a second push to main must not
    // publish again, so every later step is gated on the tag being absent.
    expect(workflow).toContain('if git rev-parse -q --verify "refs/tags/${TAG}"');
    expect(workflow).toContain("already-released=true");
    const gates = workflow.match(/if: steps\.version\.outputs\.already-released == 'false'/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(6);
  });

  it('verifies the exact commit it packages', () => {
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run build');
    // Packaging happens on macOS because that is the only target it builds.
    expect(workflow).toContain('runs-on: macos-latest');
    expect(workflow).toContain('electron-builder --mac --publish never');
  });

  it('tags, branches, and publishes the artifacts it built', () => {
    expect(workflow).toContain('git tag -a "$TAG"');
    expect(workflow).toContain('git push origin "refs/tags/$TAG"');
    expect(workflow).toContain('git push origin "HEAD:refs/heads/release/$TAG"');
    expect(workflow).toContain('gh release create "$TAG"');
    expect(workflow).toContain('--generate-notes');
    expect(workflow).toContain('dist/*.dmg dist/*.zip');
  });

  it('states plainly that the build is unsigned instead of leaving it to be discovered', () => {
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: false');
    expect(workflow).toMatch(/unsigned and not notarized/);
    expect(builderConfig).toContain('identity: null');
  });

  it('pins actions to immutable commit SHAs', () => {
    const uses = workflow.match(/uses: [^\n]+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/@[0-9a-f]{40}/);
    }
  });

  it('keeps packaging able to run locally with the same inputs', () => {
    expect(packageJson.scripts.package).toBe('npm run build && electron-builder --mac --publish never');
    expect(packageJson.devDependencies['electron-builder']).toBeDefined();
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    // electron-vite writes the app into out/; the package must carry it.
    expect(builderConfig).toContain('out/**');
    expect(builderConfig).toContain('productName: OpenVideo');
  });
});
