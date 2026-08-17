import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_EVENTS,
  OPENPANEL_API_URL,
  OPENPANEL_CLIENT_ID,
  isAnalyticsEvent,
  sanitiseProperties
} from '../mobile/src/lib/analytics';

/**
 * What usage reporting may carry.
 *
 * The app holds prompts, API keys, file names and the contents of someone's
 * edit. None of that is product analytics and all of it is the user's, so the
 * rule worth a test is not "does an event arrive" — it is that no event can
 * express any of those things even if a call site tries.
 */

const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

describe('analytics properties', () => {
  it('keeps counts, durations and flags', () => {
    expect(sanitiseProperties({ seconds: 8, clips: 3, toPhotos: true, failed: null })).toEqual({
      seconds: 8,
      clips: 3,
      toPhotos: true,
      failed: null
    });
  });

  it('drops anything that could be the user own words', () => {
    // Values are numbers, booleans or null, so a string is refused whatever it
    // is called — a prompt cannot arrive under an innocent key.
    const cleaned = sanitiseProperties({ seconds: 4, note: 'a cat riding a bicycle' } as never);
    expect(cleaned).toEqual({ seconds: 4 });
  });

  it('drops keys that name something private, whatever the value', () => {
    // A floor beneath the type rule, because the mistake this guards against is
    // reaching for the obvious name while adding a field in a hurry.
    for (const key of ['prompt', 'fileName', 'projectTitle', 'apiKey', 'sourceUri', 'userEmail', 'file_path']) {
      expect(sanitiseProperties({ [key]: 1 }), `${key} must not be reportable`).toEqual({});
    }
  });

  it('rounds numbers rather than reporting them exactly', () => {
    // Precision is what makes a number identifying; nobody is asking a question
    // that needs a duration to the fraction of a millisecond.
    expect(sanitiseProperties({ tookMs: 8123.4567 })).toEqual({ tookMs: 8123 });
    expect(sanitiseProperties({ ratio: Number.NaN, size: Number.POSITIVE_INFINITY })).toEqual({});
  });
});

describe('the event list', () => {
  it('is closed', () => {
    // A closed list is what makes "no prompts, no file names" checkable: a new
    // event is a decision in one file rather than a string typed in a screen.
    expect(isAnalyticsEvent('export_finished')).toBe(true);
    expect(isAnalyticsEvent('user_typed_prompt')).toBe(false);
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });
});

describe('the OpenPanel client', () => {
  it('carries the write key and the publisher own instance', () => {
    expect(OPENPANEL_CLIENT_ID).toBe('329420cf-2ae4-495f-a35b-3cae1412110f');
    expect(OPENPANEL_API_URL).toBe('https://panel.sanhouse.kr/api');
  });

  it('never carries the client secret', async () => {
    // It is for server-to-server events, and an app on someone's phone is
    // neither. A secret shipped in a binary is a secret anyone can read out of
    // it, so the repository must not hold one at all.
    for (const path of ['src/lib/analytics.ts', 'src/lib/analyticsClient.ts']) {
      const source = await read(path);
      expect(source).not.toMatch(/clientSecret\s*:/);
      expect(source, 'no OpenPanel secret may be committed').not.toMatch(/sec_[a-z0-9]{16,}/i);
    }
  });

  it('asks the switch before it sends, and loads the SDK lazily', async () => {
    const client = await read('src/lib/analyticsClient.ts');
    // Checked before rather than at the far end: a client that is initialised
    // and then told to be quiet has already announced itself.
    expect(client).toMatch(/if \(!analyticsEnabled\(\)\) return;/);
    // Same lesson as the ad SDK: a top-level import of something the runtime
    // cannot provide takes the app down before a screen mounts.
    expect(client).not.toMatch(/^import .*from '@openpanel\/react-native';$/m);
    expect(client).toContain("require('@openpanel/react-native')");
  });

  it('treats an unreadable preference as off', async () => {
    // Off is the side that cannot be wrong about someone's wishes.
    const client = await read('src/lib/analyticsClient.ts');
    expect(client).toMatch(/catch \{[\s\S]{0,220}return false;/);
  });

  it('identifies nobody', async () => {
    const client = await read('src/lib/analyticsClient.ts');
    expect(client).not.toContain('identify(');
  });
});

describe('the claims about it', () => {
  it('say so where the app and the repository already made a promise', async () => {
    // "No analytics" was stated in the README, in AGENTS.md and on two desktop
    // screens. Shipping this while those stand would make the app lie to the
    // person reading them.
    const readRoot = (p: string) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

    const readme = await readRoot('README.md');
    expect(readme).not.toContain('No analytics, crash reporting, or usage tracking.');
    expect(readme).toContain('usage counts');

    const agents = await readRoot('AGENTS.md');
    expect(agents).toContain('OpenPanel instance');
    expect(agents).toContain('mobile/src/lib/analytics.ts');

    // Both stores check declarations against what is in the binary.
    const releasing = await readFile(new URL('../mobile/RELEASING.md', import.meta.url), 'utf8');
    expect(releasing).toContain('panel.sanhouse.kr');
    expect(releasing).toContain('not used for tracking');
  });

  it('leaves the desktop claims alone, because they are still true', async () => {
    // The exception is mobile only. A desktop screen saying there is no
    // analytics is accurate, and weakening it would be its own kind of lie.
    const settings = await readFile(new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('No account system, analytics, crash reporting, cloud upload');
  });

  it('offers the switch in Settings rather than only in a policy', async () => {
    const screen = await read('src/screens/SettingsScreen.tsx');
    expect(screen).toContain('useAnalyticsPreference');
    expect(screen).toContain('accessibilityRole="switch"');
    expect(screen).toContain('Usage reporting');
    // Not the spend rows' label style: that one capitalises, because those rows
    // render a feature id rather than a sentence, and reusing it here produced
    // "Send Anonymous Usage Counts".
    expect(screen).toContain('styles.switchLabel');
    expect(screen).toMatch(/switchLabel: \{(?![^}]*textTransform)[^}]*\}/);
  });
});
