import appConfig from '../../app.json';

/**
 * Who publishes this app.
 *
 * An app carrying ads is a published thing rather than a personal build, and
 * both the stores and AdMob expect a publisher a user can identify and reach.
 * The site is also where a privacy policy has to live, which serving ads
 * requires of its own accord.
 */
export const DEVELOPER_NAME = 'sloki9637';
export const DEVELOPER_SITE = 'sloki9637.com';

/**
 * Read from the config rather than written out again.
 *
 * A version string kept in two places is a version string that disagrees with
 * itself at the worst moment — a user reporting a bug against a number the
 * build does not actually have.
 */
export const APP_VERSION: string = appConfig.expo.version;
