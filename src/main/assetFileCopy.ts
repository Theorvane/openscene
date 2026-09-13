import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';

import { isInsideDirectory, ProjectStoreError } from './projectStoreSupport';

type CopyAssetFileInput = {
  readonly sourcePath: string;
  readonly destinationDirectory: string;
  readonly destinationPath: string;
  readonly maximumBytes: number;
};

function isSameFileVersion(
  before: Awaited<ReturnType<FileHandle['stat']>>,
  after: Awaited<ReturnType<FileHandle['stat']>>
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

const COPY_BUFFER_BYTES = 64 * 1_024;

async function hashOpenFile(file: FileHandle): Promise<Buffer> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) return hash.digest();
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
}

async function copyOpenFiles(source: FileHandle, destination: FileHandle, maximumBytes: number): Promise<Buffer> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) return hash.digest();
    if (position + bytesRead > maximumBytes) {
      throw new ProjectStoreError(`Asset source exceeds the ${maximumBytes} byte limit.`);
    }
    hash.update(buffer.subarray(0, bytesRead));
    let written = 0;
    while (written < bytesRead) {
      const result = await destination.write(buffer, written, bytesRead - written, position + written);
      if (result.bytesWritten === 0) throw new ProjectStoreError('Asset copy stopped before all bytes were written.');
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}

export async function copyAssetFile(input: CopyAssetFileInput): Promise<number> {
  const directoryStats = await lstat(input.destinationDirectory);
  const directoryRealPath = await realpath(input.destinationDirectory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new ProjectStoreError('Asset destination must be an app-owned directory.');
  }
  const source = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destination: FileHandle | undefined;
  let verificationSource: FileHandle | undefined;
  let verificationDestination: FileHandle | undefined;
  try {
    const beforeCopy = await source.stat();
    if (!beforeCopy.isFile()) {
      throw new ProjectStoreError('Asset source must be a regular file.');
    }
    if (beforeCopy.size > input.maximumBytes) {
      throw new ProjectStoreError(`Asset source exceeds the ${input.maximumBytes} byte limit.`);
    }
    destination = await open(
      input.destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    const copiedHash = await copyOpenFiles(source, destination, input.maximumBytes);
    // Flush through the writable handle. Windows rejects fsync on a handle
    // opened O_RDONLY with EPERM, even though POSIX platforms may accept it.
    // The explicit read/write loop keeps both handles open so the copy can be
    // durably flushed before the independent verification pass below.
    await destination.sync();
    verificationSource = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    verificationDestination = await open(input.destinationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [sourceAfterCopy, copiedStats, destinationRealPath, directoryAfterCopy] = await Promise.all([
      verificationSource.stat(),
      verificationDestination.stat(),
      realpath(input.destinationPath),
      lstat(input.destinationDirectory)
    ]);
    const finalSourceHash = await hashOpenFile(verificationSource);
    const [sourceAfterHash, destinationAfterHash] = await Promise.all([
      lstat(input.sourcePath),
      lstat(input.destinationPath)
    ]);
    const destinationStayedInside = isInsideDirectory(directoryRealPath, destinationRealPath);
    const directoryStayedStable =
      !directoryAfterCopy.isSymbolicLink() &&
      directoryAfterCopy.isDirectory() &&
      directoryAfterCopy.dev === directoryStats.dev &&
      directoryAfterCopy.ino === directoryStats.ino;
    if (
      !copiedStats.isFile() ||
      copiedStats.size > input.maximumBytes ||
      copiedStats.size !== beforeCopy.size ||
      !isSameFileVersion(beforeCopy, sourceAfterCopy) ||
      !isSameFileVersion(beforeCopy, sourceAfterHash) ||
      !isSameFileVersion(copiedStats, destinationAfterHash) ||
      !timingSafeEqual(copiedHash, finalSourceHash) ||
      !destinationStayedInside ||
      !directoryStayedStable
    ) {
      throw new ProjectStoreError('Asset source or destination changed while it was being copied.');
    }
    return copiedStats.size;
  } finally {
    await verificationDestination?.close();
    await verificationSource?.close();
    await destination?.close();
    await source.close();
  }
}
