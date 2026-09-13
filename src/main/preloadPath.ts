import { posix, win32 } from 'node:path';

export function resolvePreloadScriptPath(mainOutputDirectory: string): string {
  // `__dirname` is native in production, while unit tests and recovered debug
  // records may carry a path from another OS. Select the path grammar from the
  // value instead of silently rewriting its separators with the host grammar.
  const paths = mainOutputDirectory.includes('\\') ? win32 : posix;
  return paths.resolve(mainOutputDirectory, '../preload/index.cjs');
}
