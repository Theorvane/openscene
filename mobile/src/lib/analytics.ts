/**
 * What the app is allowed to report about itself, and what it never reports.
 *
 * OpenPanel is self-hosted — the events go to a server the publisher runs, not
 * to a third party — but "we host it" is not the same as "anything may be sent",
 * and the interesting rule here is the second one. This app holds prompts, API
 * keys, file names, and the contents of someone's edit. None of that is product
 * analytics; all of it is the user's. So events carry a name and a small set of
 * declared properties, and the properties are the kind of thing that could be
 * printed on a dashboard without anyone minding.
 *
 * Kept free of React Native so the rule can be tested, the way the ad units and
 * the interstitial decision are.
 */

/** The project's public write key. Not a secret: a client has to carry it to report anything. */
export const OPENPANEL_CLIENT_ID = '329420cf-2ae4-495f-a35b-3cae1412110f';

/**
 * The publisher's own instance.
 *
 * There is no client secret here and there should never be one. OpenPanel uses
 * it for server-to-server events, and an app on a user's phone is neither — a
 * secret shipped in a binary is a secret anyone can read out of it.
 */
export const OPENPANEL_API_URL = 'https://panel.sanhouse.kr/api';

/**
 * Every event the app may send, named here rather than at the call sites.
 *
 * A closed list is what makes "no prompts, no file names" checkable. A new event
 * is a line in this file and a decision about whether it belongs, instead of a
 * string someone typed in a screen.
 */
export const ANALYTICS_EVENTS = [
  'app_opened',
  'project_created',
  'clip_imported',
  'export_started',
  'export_finished',
  'export_failed',
  'generation_started',
  'generation_finished',
  'library_item_added_to_timeline'
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Property values that are safe to report: counts, durations, flags, and short
 * enumerated labels the app itself chose. Never free text.
 */
export type AnalyticsValue = number | boolean | null;

export type AnalyticsProperties = Readonly<Record<string, AnalyticsValue>>;

/**
 * Keys that must never appear on an event, whatever a call site believes.
 *
 * This is a floor rather than the rule — the rule is that values are numbers,
 * booleans or nothing, which already excludes a prompt. It exists because the
 * mistake this guards against is not a wrong type, it is someone reaching for
 * the obvious name while adding a field in a hurry.
 */
const FORBIDDEN_KEYS: readonly string[] = [
  'prompt',
  'text',
  'name',
  'filename',
  'file',
  'path',
  'uri',
  'url',
  'key',
  'apikey',
  'token',
  'secret',
  'email',
  'title',
  'message',
  'query',
  'content',
  // Plurals and the spellings the same idea arrives under, because the match is
  // now exact and an exact match is only as good as the list.
  'prompts',
  'files',
  'paths',
  'uris',
  'urls',
  'keys',
  'tokens',
  'secrets',
  'emails',
  'titles',
  'messages',
  'queries',
  'names'
];

/**
 * Whole words, not substrings.
 *
 * Matching on a substring dropped `keyframes` for containing "key", which is a
 * count with nothing to do with credentials — and it dropped it silently, so the
 * dashboard would simply have been missing a number nobody could explain. The
 * key is split on camel case and separators instead, and a segment has to *be* a
 * forbidden word rather than merely contain one.
 *
 * `pathCount` and `contentClips` are still refused, and that is the intended
 * answer rather than a leftover: a numeric field whose name contains the word
 * "path" or "content" wants renaming, not permission.
 */
function forbidden(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
  return words.some((word) => FORBIDDEN_KEYS.includes(word));
}

/**
 * The properties an event is actually allowed to carry.
 *
 * Drops rather than throws. An analytics call is not worth crashing an export
 * over, and a dropped property is visible on the dashboard as an absence, which
 * is the right way round: the product keeps working and the data looks wrong
 * until someone fixes the call.
 */
export function sanitiseProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const safe: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (forbidden(key)) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      // Rounded: a duration to the millisecond is more precise than any question
      // worth asking, and precision is what makes a number identifying.
      safe[key] = Math.round(value);
      continue;
    }
    if (typeof value === 'boolean' || value === null) safe[key] = value;
  }
  return safe;
}

export function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}
