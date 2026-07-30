const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared');

const config = getDefaultConfig(projectRoot);

/**
 * The whole point of this app is that it consumes the desktop app's domain code
 * rather than a copy of it. Metro will not read files above the project root
 * unless they are watched, so the shared directory is added explicitly — the
 * narrowest thing that works, rather than watching the repository root and
 * pulling the Electron sources into the bundler's graph.
 */
config.watchFolders = [sharedRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@openvideo/shared': sharedRoot
};

module.exports = config;
