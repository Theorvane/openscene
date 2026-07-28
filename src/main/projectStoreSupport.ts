import { constants } from 'node:fs';
import { lstat, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { LocalProjectSnapshot } from '../shared/timelineTypes';
import { TIMELINE_VALIDATION_LIMITS, getRelativePath } from '../shared/timelineValidationPrimitives';
import { PROJECT_ASSETS_DIRECTORY } from './assetLibrarySupport';
import { parsePersistedProjectForRead } from './projectSnapshotCodec';

export const PROJECT_FILE_NAME = 'project.json';
export { PROJECT_ASSETS_DIRECTORY };

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class ProjectStoreError extends Error {
  override readonly name = 'ProjectStoreError';
}

export function isOpaqueId(value: string): boolean {
  return value.length <= TIMELINE_VALIDATION_LIMITS.opaqueIdLength && OPAQUE_ID_PATTERN.test(value);
}

export function assertOpaqueId(value: string, label: string): void {
  if (!isOpaqueId(value)) {
    throw new ProjectStoreError(`Invalid ${label}.`);
  }
}

export function isInsideDirectory(parentDirectory: string, childPath: string): boolean {
  const childRelativePath = relative(resolve(parentDirectory), resolve(childPath));
  return (
    childRelativePath === '' ||
    (childRelativePath !== '..' && !childRelativePath.startsWith(`..${sep}`) && !isAbsolute(childRelativePath))
  );
}

export function projectDirectory(rootDirectory: string, projectId: string): string {
  assertOpaqueId(projectId, 'project id');
  const directory = resolve(rootDirectory, projectId);
  if (!isInsideDirectory(rootDirectory, directory)) {
    throw new ProjectStoreError('Resolved project path escaped the configured root directory.');
  }
  return directory;
}

export function projectAssetPath(rootDirectory: string, projectId: string, projectRelativePath: string): string {
  return projectAssetPathWithinDirectory(projectDirectory(rootDirectory, projectId), projectRelativePath);
}

/**
 * Resolve a project-relative asset path against an explicit project directory
 * (internal root/id folders and registered external folders share the same
 * confinement rule: the resolved path may never escape the project directory).
 */
export function projectAssetPathWithinDirectory(projectDirectoryPath: string, projectRelativePath: string): string {
  const parsedPath = getRelativePath({ path: projectRelativePath }, 'path');
  if (parsedPath === null) {
    throw new ProjectStoreError('Invalid project-relative asset path.');
  }
  const directory = resolve(projectDirectoryPath);
  const assetPath = resolve(directory, parsedPath);
  if (!isInsideDirectory(directory, assetPath)) {
    throw new ProjectStoreError('Resolved asset path escaped its project directory.');
  }
  return assetPath;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP');
}

type DirectoryIdentity = {
  readonly device: number;
  readonly inode: number;
  readonly realPath: string;
};

async function getDirectoryIdentity(rootDirectory: string, directory: string): Promise<DirectoryIdentity | null> {
  const [stats, rootRealPath, directoryRealPath] = await Promise.all([
    lstat(directory),
    realpath(rootDirectory),
    realpath(directory)
  ]);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !isInsideDirectory(rootRealPath, directoryRealPath)) {
    return null;
  }
  return { device: stats.dev, inode: stats.ino, realPath: directoryRealPath };
}

async function directoryMatches(directory: string, identity: DirectoryIdentity): Promise<boolean> {
  const stats = await lstat(directory);
  return !stats.isSymbolicLink() && stats.isDirectory() && stats.dev === identity.device && stats.ino === identity.inode;
}

export async function readProjectSnapshot(rootDirectory: string, projectId: string): Promise<LocalProjectSnapshot | null> {
  return readProjectSnapshotAtDirectory(projectDirectory(rootDirectory, projectId), projectId);
}

/**
 * Read a snapshot from an explicit project directory. When expectedProjectId is
 * null (opening a user-picked folder), the persisted id inside project.json is
 * validated and used instead.
 */
export async function readProjectSnapshotAtDirectory(
  projectDirectoryPath: string,
  expectedProjectId: string | null
): Promise<LocalProjectSnapshot | null> {
  const directory = resolve(projectDirectoryPath);
  const projectFile = join(directory, PROJECT_FILE_NAME);
  try {
    const identity = await getDirectoryIdentity(dirname(directory), directory);
    if (identity === null) {
      return null;
    }
    const file = await open(projectFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const fileStats = await file.stat();
      if (!fileStats.isFile() || !(await directoryMatches(directory, identity))) {
        return null;
      }
      const raw: unknown = JSON.parse(await file.readFile('utf8'));
      const persistedId = typeof raw === 'object' && raw !== null && 'id' in raw && typeof (raw as { id: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : null;
      const projectId = expectedProjectId ?? persistedId;
      if (projectId === null || !isOpaqueId(projectId)) {
        return null;
      }
      return parsePersistedProjectForRead(raw, projectId);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isMissingPathError(error) || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function writeProjectSnapshot(rootDirectory: string, snapshot: LocalProjectSnapshot): Promise<void> {
  return writeProjectSnapshotAtDirectory(projectDirectory(rootDirectory, snapshot.id), snapshot);
}

export async function writeProjectSnapshotAtDirectory(projectDirectoryPath: string, snapshot: LocalProjectSnapshot): Promise<void> {
  const directory = resolve(projectDirectoryPath);
  const projectFile = join(directory, PROJECT_FILE_NAME);
  const temporaryFile = join(directory, `.${PROJECT_FILE_NAME}.${randomUUID()}.tmp`);
  const identity = await getDirectoryIdentity(dirname(directory), directory);
  if (identity === null || !isInsideDirectory(directory, temporaryFile)) {
    throw new ProjectStoreError('Resolved temporary project path escaped its project directory.');
  }
  let temporaryFileHandle: FileHandle | undefined;
  try {
    temporaryFileHandle = await open(
      temporaryFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await temporaryFileHandle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await temporaryFileHandle.sync();
    const [temporaryStats, temporaryRealPath, parentMatches] = await Promise.all([
      temporaryFileHandle.stat(),
      realpath(temporaryFile),
      directoryMatches(directory, identity)
    ]);
    if (!temporaryStats.isFile() || !isInsideDirectory(identity.realPath, temporaryRealPath) || !parentMatches) {
      throw new ProjectStoreError('Project directory changed while its snapshot was being written.');
    }
    await temporaryFileHandle.close();
    temporaryFileHandle = undefined;
    const pathStats = await lstat(temporaryFile);
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== temporaryStats.dev ||
      pathStats.ino !== temporaryStats.ino ||
      !(await directoryMatches(directory, identity))
    ) {
      throw new ProjectStoreError('Project snapshot changed before it could be published.');
    }
    await rename(temporaryFile, projectFile);
  } catch (error) {
    await temporaryFileHandle?.close();
    await rm(temporaryFile, { force: true });
    throw error;
  }
}
