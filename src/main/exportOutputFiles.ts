import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createDeliveryProvenanceSidecar, type DeliveryProvenance } from '../shared/exportProvenance';
import type { SubtitleSidecar } from '../shared/subtitleDelivery';

import { isInsideDirectory, isOpaqueId } from './projectStoreSupport';

export class ExportOutputError extends Error {
  override readonly name = 'ExportOutputError';
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function secureRootPath(rootDirectory: string): Promise<string> {
  const before = await lstat(rootDirectory);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new ExportOutputError('Configured export root must be a real directory.');
  }
  const rootRealPath = await realpath(rootDirectory);
  const after = await lstat(rootDirectory);
  if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new ExportOutputError('Configured export root changed during access.');
  }
  return rootRealPath;
}

export async function prepareExportOutputPath(rootDirectory: string, jobId: string): Promise<string> {
  if (!isAbsolute(rootDirectory) || !isOpaqueId(jobId)) {
    throw new ExportOutputError('Export output configuration was not safe.');
  }
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const rootRealPath = await secureRootPath(rootDirectory);
  await chmod(rootDirectory, 0o700);
  const outputPath = resolve(rootRealPath, `${jobId}.mp4`);
  if (!isInsideDirectory(rootRealPath, outputPath)) {
    throw new ExportOutputError('Export output path escaped its configured root.');
  }
  try {
    await lstat(outputPath);
    throw new ExportOutputError('Export output path already exists.');
  } catch (error: unknown) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
  return outputPath;
}

export async function validateExportOutput(rootDirectory: string, outputPath: string): Promise<{ readonly fileName: string; readonly fileSizeBytes: number }> {
  const rootRealPath = await secureRootPath(rootDirectory);
  const file = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [outputRealPath, outputStats, pathStats] = await Promise.all([
      realpath(outputPath),
      file.stat(),
      lstat(outputPath)
    ]);
    if (
      !isInsideDirectory(rootRealPath, outputRealPath) ||
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      !outputStats.isFile() ||
      pathStats.dev !== outputStats.dev ||
      pathStats.ino !== outputStats.ino ||
      outputStats.size <= 0
    ) {
      throw new ExportOutputError('FFmpeg did not create a valid contained MP4 output.');
    }
    return { fileName: basename(outputPath), fileSizeBytes: outputStats.size };
  } finally {
    await file.close();
  }
}

export async function removeExportOutput(outputPath: string): Promise<void> {
  await rm(outputPath, { force: true });
}

/** Hashes the validated regular output without loading a potentially large MP4 into memory. */
export async function hashExportOutput(outputPath: string): Promise<{ readonly sha256: string; readonly fileSizeBytes: number }> {
  const file = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const stats = await file.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size !== position) {
      throw new ExportOutputError('The MP4 changed while its delivery checksum was calculated.');
    }
    return { sha256: hash.digest('hex'), fileSizeBytes: stats.size };
  } finally {
    await file.close();
  }
}

export type WrittenSubtitleSidecar = {
  readonly outputPath: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
};

export type WrittenProvenanceSidecar = {
  readonly outputPath: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
};

/** Writes the path-free delivery manifest beside its MP4 using create-new semantics. */
export async function writeExportProvenanceSidecar(
  rootDirectory: string,
  jobId: string,
  provenance: DeliveryProvenance
): Promise<WrittenProvenanceSidecar> {
  if (!isAbsolute(rootDirectory) || !isOpaqueId(jobId)) {
    throw new ExportOutputError('Provenance output configuration was not safe.');
  }
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const rootRealPath = await secureRootPath(rootDirectory);
  const outputPath = resolve(rootRealPath, `${jobId}.provenance.json`);
  if (!isInsideDirectory(rootRealPath, outputPath)) throw new ExportOutputError('Provenance output path escaped its configured root.');
  const contents = createDeliveryProvenanceSidecar(provenance).contents;
  if (Buffer.byteLength(contents, 'utf8') > 4 * 1024 * 1024) {
    throw new ExportOutputError('The provenance sidecar exceeded the 4 MB delivery limit.');
  }
  let created = false;
  try {
    const file = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      await file.writeFile(contents, { encoding: 'utf8' });
      await file.sync();
    } finally {
      await file.close();
    }
    const validated = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const [real, stats, pathStats] = await Promise.all([realpath(outputPath), validated.stat(), lstat(outputPath)]);
      if (!isInsideDirectory(rootRealPath, real) || pathStats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
        throw new ExportOutputError('The provenance sidecar was not a valid contained file.');
      }
      const parsed = JSON.parse(await validated.readFile({ encoding: 'utf8' })) as { schemaVersion?: unknown };
      if (parsed.schemaVersion !== provenance.schemaVersion) {
        throw new ExportOutputError('The provenance sidecar did not round-trip through JSON safely.');
      }
      return { outputPath, fileName: basename(outputPath), fileSizeBytes: stats.size };
    } finally {
      await validated.close();
    }
  } catch (error) {
    if (created) await rm(outputPath, { force: true });
    throw error;
  }
}

/** Writes a generated-name UTF-8 sidecar beside the MP4 without accepting any renderer path. */
export async function writeExportSubtitleSidecar(
  rootDirectory: string,
  jobId: string,
  sidecar: SubtitleSidecar
): Promise<WrittenSubtitleSidecar> {
  if (!isAbsolute(rootDirectory) || !isOpaqueId(jobId)) {
    throw new ExportOutputError('Subtitle output configuration was not safe.');
  }
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const rootRealPath = await secureRootPath(rootDirectory);
  const outputPath = resolve(rootRealPath, `${jobId}.${sidecar.extension}`);
  if (!isInsideDirectory(rootRealPath, outputPath)) throw new ExportOutputError('Subtitle output path escaped its configured root.');
  let created = false;
  try {
    const file = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      await file.writeFile(sidecar.contents, { encoding: 'utf8' });
      await file.sync();
    } finally {
      await file.close();
    }
    const validated = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const [real, stats, pathStats] = await Promise.all([realpath(outputPath), validated.stat(), lstat(outputPath)]);
      if (!isInsideDirectory(rootRealPath, real) || pathStats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
        throw new ExportOutputError('The subtitle sidecar was not a valid contained file.');
      }
      return { outputPath, fileName: basename(outputPath), fileSizeBytes: stats.size };
    } finally {
      await validated.close();
    }
  } catch (error) {
    if (created) await rm(outputPath, { force: true });
    throw error;
  }
}
