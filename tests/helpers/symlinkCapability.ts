import { symlink } from 'node:fs/promises';

/**
 * Creates the link used by a filesystem-security test.
 *
 * Windows requires Developer Mode or an elevated token for ordinary symbolic
 * links. A machine without that capability cannot construct the attack fixture,
 * so the test is reported as skipped there; real links remain mandatory on CI
 * and on Windows environments where link creation is enabled.
 */
export async function createSymlinkOrSkip(
  target: string,
  path: string,
  skip: () => void,
  type?: 'dir' | 'file' | 'junction'
): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error: unknown) {
    if (
      process.platform === 'win32' &&
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      skip();
      return false;
    }
    throw error;
  }
}
