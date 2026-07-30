import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHARED_DIR = resolve(process.cwd(), 'src/shared');

function sharedFiles(): readonly { readonly name: string; readonly source: string }[] {
  return readdirSync(SHARED_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(SHARED_DIR, name), 'utf8') }));
}

const files = sharedFiles();

describe('shared core portability', () => {
  it('found the shared modules to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never reaches for Node built-ins', () => {
    // The mobile app typechecks and bundles these same files. A node: import
    // would fail there, and only there — the desktop build would stay green.
    for (const { name, source } of files) {
      expect(source, `${name} imports a Node built-in`).not.toMatch(/from '(node:|fs|path|os|child_process|crypto)'/);
      expect(source, `${name} requires a Node built-in`).not.toMatch(/require\('node:/);
    }
  });

  it('never reaches for Electron', () => {
    for (const { name, source } of files) {
      expect(source, `${name} imports electron`).not.toMatch(/from 'electron'/);
    }
  });

  /** Comments legitimately name what the rule forbids; only code is checked. */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('never reaches for the DOM', () => {
    // React Native has no window or document; shared code that touches either
    // would throw at runtime rather than fail to build.
    for (const { name, source } of files) {
      const code = withoutComments(source);
      expect(code, `${name} touches window`).not.toMatch(/\bwindow\./);
      expect(code, `${name} touches document`).not.toMatch(/\bdocument\./);
      expect(code, `${name} touches localStorage`).not.toMatch(/\blocalStorage\b/);
    }
  });

  it('does not borrow types from the NodeJS global namespace', () => {
    // This is the one the mobile typecheck actually caught: models.ts and
    // updater.ts used NodeJS.Platform, so the shared core quietly depended on a
    // Node type environment. HostPlatform replaces it.
    for (const { name, source } of files) {
      expect(withoutComments(source), `${name} uses a NodeJS.* type`).not.toMatch(/\bNodeJS\.[A-Z]/);
    }
  });
});
