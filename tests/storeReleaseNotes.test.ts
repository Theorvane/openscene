import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * What each store is told, checked before a reviewer checks it.
 *
 * App Review rejected a build under Guideline 2.3.10 because the "What's New"
 * text mentioned Android. The two stores' notes were written by hand into two
 * different consoles, and the Play wording is the obvious thing to paste — so
 * the mistake was structural rather than careless, and the only reader who
 * could catch it was Apple.
 *
 * The notes live in the repository now, one file per store per language, and
 * this refuses another platform's name in every App Store file. It publishes
 * nothing; the consoles are still filled in by hand. It moves the failure from
 * "rejected after review" to "a red test before submitting".
 */

const directory = (store: string) => new URL(`../store/${store}/`, import.meta.url);

async function notesIn(store: string): Promise<readonly (readonly [string, string])[]> {
  const names = (await readdir(directory(store))).filter((name) => name.endsWith('.txt')).sort();
  return Promise.all(
    names.map(async (name) => [name, await readFile(new URL(name, directory(store)), 'utf8')] as const)
  );
}

/** The locale a file is for: `whats-new.ko.txt` is Korean. */
const localeOf = (name: string): string => name.split('.').slice(-2, -1)[0] ?? '';

/**
 * Names Apple will not accept in App Store metadata, and the spellings they
 * arrive under. `Play` on its own is deliberately absent — "playback" and "play
 * the clip" are ordinary words in an editor's release notes.
 */
const OTHER_PLATFORMS = [/android/i, /안드로이드/, /google play/i, /구글 ?플레이/, /play store/i, /플레이 ?스토어/, /\bapk\b/i, /galaxy store/i, /갤럭시 ?스토어/, /sideload/i];

describe('the App Store notes', () => {
  it('exist in at least English and Korean', async () => {
    const locales = (await notesIn('app-store')).map(([name]) => localeOf(name));
    expect(locales).toContain('en-US');
    expect(locales).toContain('ko');
  });

  it('name no other platform, in any language', async () => {
    for (const [name, text] of await notesIn('app-store')) {
      for (const pattern of OTHER_PLATFORMS) {
        expect(text, `${name} must not mention ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('fit what App Store Connect accepts', async () => {
    for (const [name, text] of await notesIn('app-store')) {
      expect(text.trim().length, `${name} is empty`).toBeGreaterThan(0);
      expect(text.length, `${name} is too long`).toBeLessThanOrEqual(4_000);
    }
  });
});

describe('the Google Play notes', () => {
  it('fit the 500 characters Play allows', async () => {
    // Play truncates silently rather than refusing, which is worse: the listing
    // simply stops mid-sentence.
    for (const [name, text] of await notesIn('google-play')) {
      expect(text.trim().length, `${name} is empty`).toBeGreaterThan(0);
      expect(text.length, `${name} is too long`).toBeLessThanOrEqual(500);
    }
  });
});

describe('the two stores', () => {
  it('are offered the same languages', async () => {
    // A release announced in Korean on one store and not the other is a
    // listing someone forgot rather than a decision someone made.
    const locales = async (store: string) => (await notesIn(store)).map(([name]) => localeOf(name)).sort();
    expect(await locales('app-store')).toEqual(await locales('google-play'));
  });

  it('describe the same release in each language', async () => {
    // Not identical — each store has its own limits and house style — but a
    // release that claimed one thing on one store and another elsewhere would
    // be two different accounts of one build.
    const firstLines = async (store: string) =>
      Object.fromEntries((await notesIn(store)).map(([name, text]) => [localeOf(name), text.trim().split('\n')[0]]));
    expect(await firstLines('app-store')).toEqual(await firstLines('google-play'));
  });
});
