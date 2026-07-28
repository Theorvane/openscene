import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';

import type { LocalProjectSnapshot, MediaAsset, MediaKind } from '../shared/timelineTypes';
import { parseImportMediaInput } from '../shared/timelineValidators';
import { copyAssetFile } from './assetFileCopy';
import {
  AssetImportValidationError,
  assertAssetImportQuota,
  assertAssetSelectionCount,
  type AssetImportLimits
} from './assetImportPolicy';
import { supportedAssetExtension } from './assetLibrarySupport';
import type { ProjectStore } from './projectStore';
import {
  PROJECT_ASSETS_DIRECTORY,
  ProjectStoreError,
  assertOpaqueId,
  isInsideDirectory,
  projectAssetPathWithinDirectory
} from './projectStoreSupport';

export type ImportAssetFromPathInput = {
  readonly projectId: string;
  readonly sourcePath: string;
  readonly displayName: string;
  readonly kind: MediaKind;
  readonly mimeType: string;
};

type PreparedImport = {
  readonly asset: MediaAsset;
  readonly sourcePath: string;
  readonly assetDirectory: string;
  readonly destinationPath: string;
};

type EnsuredAssetsDirectory = {
  readonly path: string;
  readonly created: boolean;
};

type ImportBatchInput = {
  readonly rootDirectory: string;
  readonly projects: ProjectStore;
  readonly imports: readonly ImportAssetFromPathInput[];
  readonly limits: AssetImportLimits;
  readonly now: Date;
};

function resolveAssetsDirectory(projectPath: string): string {
  const assetsPath = join(projectPath, PROJECT_ASSETS_DIRECTORY);
  if (!isInsideDirectory(projectPath, assetsPath)) {
    throw new ProjectStoreError('Resolved assets path escaped its project directory.');
  }
  return assetsPath;
}

async function ensureAssetsDirectory(projectPath: string): Promise<EnsuredAssetsDirectory> {
  const assetsPath = resolveAssetsDirectory(projectPath);
  let created = false;
  try {
    const stats = await lstat(assetsPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ProjectStoreError('Project assets path must be an app-owned directory.');
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await mkdir(assetsPath, { mode: 0o700 });
      created = true;
    } else {
      throw error;
    }
  }
  const [projectRealPath, assetsRealPath] = await Promise.all([realpath(projectPath), realpath(assetsPath)]);
  if (!isInsideDirectory(projectRealPath, assetsRealPath)) {
    throw new ProjectStoreError('Project assets path escaped its project directory.');
  }
  await chmod(assetsPath, 0o700);
  return { path: assetsPath, created };
}

async function prepareImport(
  projectPath: string,
  assetsDirectory: string,
  input: ImportAssetFromPathInput,
  timestamp: string
): Promise<PreparedImport> {
  if (!isAbsolute(input.sourcePath) || resolve(input.sourcePath) !== input.sourcePath) {
    throw new AssetImportValidationError('Asset source path must be absolute and normalized.');
  }
  const extension = supportedAssetExtension(extname(input.sourcePath).toLowerCase(), input.kind, input.mimeType);
  if (extension === null) {
    throw new AssetImportValidationError('A selected media file is not supported.');
  }
  const sourceStats = await lstat(input.sourcePath);
  if (sourceStats.isSymbolicLink()) {
    throw new AssetImportValidationError('Asset source cannot be a symbolic link.');
  }
  if (!sourceStats.isFile()) {
    throw new AssetImportValidationError('Asset source must be a regular file.');
  }
  const assetId = randomUUID();
  const projectRelativePath = `${PROJECT_ASSETS_DIRECTORY}/${assetId}/original${extension}`;
  const parsedInput = parseImportMediaInput({
    projectId: input.projectId,
    displayName: input.displayName,
    projectRelativePath,
    kind: input.kind,
    mimeType: input.mimeType,
    byteLength: sourceStats.size
  });
  if (parsedInput === null) {
    throw new AssetImportValidationError('Invalid asset import input.');
  }
  const asset: MediaAsset = {
    id: assetId,
    displayName: parsedInput.displayName,
    projectRelativePath,
    kind: parsedInput.kind,
    mimeType: parsedInput.mimeType,
    byteLength: sourceStats.size,
    metadata: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return {
    asset,
    sourcePath: input.sourcePath,
    assetDirectory: join(assetsDirectory, assetId),
    destinationPath: projectAssetPathWithinDirectory(projectPath, projectRelativePath)
  };
}

function projectAssetBytes(project: LocalProjectSnapshot): number {
  return project.assets.reduce((total, asset) => total + asset.byteLength, 0);
}

export async function importAssetBatch(input: ImportBatchInput): Promise<readonly MediaAsset[]> {
  assertAssetSelectionCount(input.imports.length, input.limits);
  const firstImport = input.imports[0];
  if (firstImport === undefined || input.imports.some((candidate) => candidate.projectId !== firstImport.projectId)) {
    throw new AssetImportValidationError('Asset imports must target one known project.');
  }
  assertOpaqueId(firstImport.projectId, 'project id');
  const project = await input.projects.open(firstImport.projectId);
  if (project === null) {
    throw new ProjectStoreError(`Project ${firstImport.projectId} was not found.`);
  }
  const projectPath = await input.projects.resolveDirectory(firstImport.projectId);
  const assetsDirectory = resolveAssetsDirectory(projectPath);
  const timestamp = input.now.toISOString();
  const prepared = await Promise.all(
    input.imports.map((candidate) => prepareImport(projectPath, assetsDirectory, candidate, timestamp))
  );
  assertAssetImportQuota(
    { selectedFileBytes: prepared.map(({ asset }) => asset.byteLength), existingProjectBytes: projectAssetBytes(project) },
    input.limits
  );
  const ensuredAssetsDirectory = await ensureAssetsDirectory(projectPath);
  const createdDirectories: string[] = [];
  try {
    for (const candidate of prepared) {
      await mkdir(candidate.assetDirectory, { mode: 0o700 });
      createdDirectories.push(candidate.assetDirectory);
      const copiedBytes = await copyAssetFile({
        sourcePath: candidate.sourcePath,
        destinationDirectory: candidate.assetDirectory,
        destinationPath: candidate.destinationPath,
        maximumBytes: input.limits.maximumFileBytes
      });
      if (copiedBytes !== candidate.asset.byteLength) {
        throw new ProjectStoreError('Copied asset size did not match its validated source size.');
      }
    }
    return await input.projects.registerAssets({
      projectId: firstImport.projectId,
      assets: prepared.map(({ asset }) => asset),
      limits: input.limits
    }, input.now);
  } catch (error) {
    await Promise.all(createdDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    if (ensuredAssetsDirectory.created) {
      await rm(ensuredAssetsDirectory.path, { recursive: true, force: true });
    }
    throw error;
  }
}
