import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_EVENTS,
  OPENPANEL_API_URL,
  OPENPANEL_CLIENT_ID,
  OPENPANEL_ORIGIN,
  filterOpenPanelPayload,
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

  it('filters SDK-added globals at the final send boundary', () => {
    const outbound: { type: string; payload: { name: string; properties: Record<string, unknown> } } = {
      type: 'track',
      payload: {
        name: 'app_opened',
        properties: {
          seconds: 7,
          enabled: true,
          __version: '0.5.0',
          __buildNumber: '5',
          __referrer: 'utm_campaign=free-text',
          __path: '/editor'
        }
      }
    };

    expect(filterOpenPanelPayload(outbound)).toBe(true);
    expect(outbound.payload.properties).toEqual({ seconds: 7, enabled: true });
    expect(filterOpenPanelPayload({ type: 'identify', payload: {} })).toBe(false);
  });

  it('matches whole words, so an innocent name survives', () => {
    // Substring matching dropped `keyframes` for containing "key" — a count with
    // nothing to do with credentials, vanishing silently, leaving a dashboard
    // missing a number nobody could explain.
    expect(sanitiseProperties({ keyframes: 12, clips: 3, tookMs: 40 })).toEqual({ keyframes: 12, clips: 3, tookMs: 40 });
    // Still refused, and that is the intended answer rather than a leftover: a
    // numeric field whose name contains the word "path" or "content" wants
    // renaming, not permission.
    expect(sanitiseProperties({ pathCount: 2, contentClips: 3 })).toEqual({});
    // The match is exact now, so the list has to carry the plurals too.
    expect(sanitiseProperties({ fileNames: 2, apiKeys: 1, prompts: 4 })).toEqual({});
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

  it('includes foreground-session boundaries', () => {
    expect(isAnalyticsEvent('app_opened')).toBe(true);
    expect(isAnalyticsEvent('app_closed')).toBe(true);
  });
});

describe('the OpenPanel client', () => {
  it('carries the write key and the publisher own instance', () => {
    expect(OPENPANEL_CLIENT_ID).toBe('329420cf-2ae4-495f-a35b-3cae1412110f');
    expect(OPENPANEL_API_URL).toBe('https://panel.sanhouse.kr/api');
    expect(OPENPANEL_ORIGIN).toBe('app://openscene');
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
    expect(client).not.toMatch(/^import .*from '@openpanel\/sdk';$/m);
    expect(client).toContain("require('@openpanel/sdk')");
    expect(client).toContain("client.api.addHeader('Origin', OPENPANEL_ORIGIN)");
    expect(client).toContain('filter: filterOpenPanelPayload');
  });

  it('treats an unreadable preference as off, and an absent one as on', async () => {
    // The two "no preference" paths resolve opposite ways on purpose, which
    // looks like an inconsistency until it is written down: no file is nobody
    // having touched the switch, an unreadable file is a decision that exists
    // and cannot be read, and overriding a "no" because the file was corrupt is
    // the one outcome that must not happen.
    const client = await read('src/lib/analyticsClient.ts');
    expect(client).toContain('if (!FILE.exists) return true;');
    expect(client).toMatch(/catch \{\s*\n\s*return false;/);
    expect(client).toContain('cannot be wrong about someone');
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

/**
 * The list was mostly aspiration.
 *
 * Nine events were declared and three were ever sent, all about export — so the
 * dashboard could say how often people exported and nothing about whether what
 * they exported had been edited, which is the only question worth asking of an
 * editor.
 */
describe('the events the app actually sends', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('sends every event it declares', async () => {
    const sources = (
      await Promise.all([
        read('App.tsx'),
        read('src/lib/editorState.ts'),
        read('src/screens/EditScreen.tsx'),
        read('src/screens/ProjectsScreen.tsx')
      ])
    ).join('\n');

    // Generation is the AI studio's to send, and lives behind a provider key
    // this suite has no business exercising.
    const wired = ANALYTICS_EVENTS.filter((event) => !event.startsWith('generation_'));
    for (const event of wired) {
      expect(sources, `${event} is declared but never sent`).toContain(`'${event}'`);
    }
  });

  it('reports an edit only once it has been accepted', async () => {
    // A refused tap is not use of a feature, and `apply` decides inside a state
    // updater — so the report goes out with the write that follows it, not from
    // inside the updater.
    const state = await read('src/lib/editorState.ts');
    expect(state).toMatch(/pendingEvent\.current = null;\s*\n\s*track\(/);
  });

  it('says which control was used without saying what it was set to', async () => {
    // "Someone graded a clip" is a product question; what colour they chose is
    // their footage.
    const state = await read('src/lib/editorState.ts');
    expect(state).toContain("name: 'clip_adjusted'");
    expect(state).toMatch(/colour: touched\.some/);
    expect(state).not.toMatch(/brightness: next\.brightness/);
  });

  it('never reports a name, a title or a file', async () => {
    const sources = (
      await Promise.all([read('src/lib/editorState.ts'), read('src/screens/EditScreen.tsx'), read('src/screens/ProjectsScreen.tsx')])
    ).join('\n');
    // The sanitiser would drop these anyway; a call site that tries is a
    // misunderstanding worth catching here.
    expect(sources).not.toMatch(/track\([^)]*displayName/);
    expect(sources).not.toMatch(/track\([^)]*\btext\b/);
    expect(sources).not.toMatch(/track\([^)]*\buri\b/);
  });
});
