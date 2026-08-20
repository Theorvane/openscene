import { readFile } from 'node:fs/promises';

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
 * The notes live in the repository now, and this refuses another platform's
 * name in the App Store copy. It does not publish anything; the consoles are
 * still filled in by hand. It moves the failure from "rejected after review" to
 * "a red test before submitting".
 */

const read = (path: string) => readFile(new URL(`../store/${path}`, import.meta.url), 'utf8');

/**
 * Names Apple will not accept in App Store metadata, and the spellings they
 * arrive under. `Play` on its own is deliberately absent — "playback" and "play
 * the clip" are ordinary words in an editor's release notes.
 */
const OTHER_PLATFORMS = [/android/i, /google play/i, /play store/i, /\bapk\b/i, /galaxy store/i, /sideload/i];

describe('the App Store notes', () => {
  it('name no other platform', async () => {
    const text = await read('app-store/whats-new.txt');
    for (const pattern of OTHER_PLATFORMS) {
      expect(text, `App Store copy must not mention ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  it('fit what App Store Connect accepts', async () => {
    const text = await read('app-store/whats-new.txt');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(4_000);
  });
});

describe('the Google Play notes', () => {
  it('fit the 500 characters Play allows', async () => {
    // Play truncates silently rather than refusing, which is worse: the listing
    // simply stops mid-sentence.
    const text = await read('google-play/release-notes.txt');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(500);
  });
});

describe('the two sets of notes', () => {
  it('describe the same release', async () => {
    // Not identical — each store has its own limits and house style — but a
    // release that fixed something on one store and not the other would be two
    // different claims about one build.
    const [apple, play] = await Promise.all([read('app-store/whats-new.txt'), read('google-play/release-notes.txt')]);
    const firstLine = (text: string) => text.trim().split('\n')[0];
    expect(firstLine(apple)).toBe(firstLine(play));
  });
});
