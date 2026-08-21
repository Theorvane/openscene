import appConfig from '../../app.json';

/**
 * Who publishes this app.
 *
 * An app carrying ads is a published thing rather than a personal build, and
 * both the stores and the ad network expect a publisher a user can identify and
 * reach. The site is also where a privacy policy has to live, which serving ads
 * requires of its own accord.
 */
export const DEVELOPER_NAME = 'sloki9637';
export const DEVELOPER_SITE = 'www.sloki9637.com';

/**
 * The two pages a published app has to be able to point at.
 *
 * Serving ads requires a privacy policy — LevelPlay asks for the URL and the
 * stores ask again — and it has to be reachable from inside the app, not only
 * from a listing page the user never sees. Full URLs rather than paths joined
 * onto the site, so what ships is exactly what was checked.
 */
export const PRIVACY_URL = 'https://www.sloki9637.com/privacy';
export const TERMS_URL = 'https://www.sloki9637.com/terms';

/**
 * Where a user writes to.
 *
 * The stores want a way to reach the publisher, and so does anyone whose export
 * failed at midnight. A support address in the app is the difference between a
 * complaint that arrives and a one-star review that does.
 */
export const CONTACT_EMAIL = 'inquiry@sloki9637.com';

/**
 * Read from the config rather than written out again.
 *
 * A version string kept in two places is a version string that disagrees with
 * itself at the worst moment — a user reporting a bug against a number the
 * build does not actually have.
 */
export const APP_VERSION: string = appConfig.expo.version;
