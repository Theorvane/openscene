const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Teaches the generated Android project to sign a release build with a real key.
 *
 * `expo prebuild` rewrites android/ from scratch, so editing build.gradle by
 * hand does not survive — a config plugin is the only edit that does. Without
 * one, `assembleRelease` signs with the debug key, which Play rejects.
 *
 * No secret lives here or anywhere else in the repository. The four values are
 * read from Gradle properties, which belong in ~/.gradle/gradle.properties (out
 * of the project, out of git) or in CI secrets:
 *
 *   OPENSCENE_STORE_FILE=/absolute/path/to/openscene-release.jks
 *   OPENSCENE_STORE_PASSWORD=...
 *   OPENSCENE_KEY_ALIAS=openscene
 *   OPENSCENE_KEY_PASSWORD=...
 *
 * When they are absent the release build falls back to the debug key, so a
 * local `assembleRelease` still works for testing and only a real submission
 * needs the keystore.
 */
const SIGNING_CONFIG = `
    release {
        // Set in ~/.gradle/gradle.properties or CI secrets — never in the repo.
        if (project.hasProperty('OPENSCENE_STORE_FILE')) {
            storeFile file(OPENSCENE_STORE_FILE)
            storePassword OPENSCENE_STORE_PASSWORD
            keyAlias OPENSCENE_KEY_ALIAS
            keyPassword OPENSCENE_KEY_PASSWORD
        }
    }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    if (!contents.includes('OPENSCENE_STORE_FILE')) {
      contents = contents.replace(
        /signingConfigs \{\n(\s*)debug \{/,
        (match, indent) => `signingConfigs {\n${SIGNING_CONFIG}\n${indent}debug {`
      );
      // Point the release build at the release config only when a keystore was
      // actually supplied. Pointing at it unconditionally makes an unsigned
      // build fail rather than fall back, which would break `assembleRelease`
      // for anyone just trying the app.
      contents = contents.replace(
        /(buildTypes \{[\s\S]*?release \{[\s\S]*?signingConfig )signingConfigs\.debug/,
        '$1project.hasProperty("OPENSCENE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug'
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
