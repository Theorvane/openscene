import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That a published artifact can be downloaded by the thing that published it.
 *
 * Windows auto-update was broken from the first release to 0.4.0, and nothing
 * caught it because every piece worked: the installer built, the asset uploaded,
 * the manifest was written. They simply disagreed about one file's name.
 *
 * electron-builder's default nsis `artifactName` is
 * `${productName} Setup ${version}.${ext}`, which has spaces in it. It writes the
 * URL into `latest.yml` with the spaces turned into hyphens; GitHub turns them
 * into dots when the asset is uploaded. The updater asks for the hyphenated name
 * and gets a 404.
 *
 * A name with no spaces in it cannot be transformed into two different things,
 * which is why this asserts the absence rather than any particular name.
 */

describe('desktop artifact names', () => {
  it('contain no spaces, so the manifest and the asset agree', async () => {
    const yaml = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8');
    const names = [...yaml.matchAll(/^\s*artifactName:\s*(.+)$/gm)].map((match) => (match[1] ?? '').trim());

    expect(names.length, 'every target that names its artifact must be checked').toBeGreaterThan(0);
    for (const name of names) {
      expect(name, `${name} must not contain a space`).not.toMatch(/\s/);
    }
  });

  it('names the Windows installer explicitly rather than taking the default', async () => {
    // The default is the whole bug. Leaving it and relying on the rest of the
    // pipeline to cope is what produced four releases nobody could update from.
    const yaml = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8');
    expect(yaml).toMatch(/^nsis:$[\s\S]*?^\s*artifactName:\s*OpenScene-Setup-\$\{version\}\.\$\{ext\}$/m);
  });
});
