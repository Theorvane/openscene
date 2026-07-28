import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { MediaAsset, UpdateAssetMetadataInput } from '../shared/timelineTypes';
import { DEFAULT_ASSET_IMPORT_LIMITS, type AssetImportLimits } from './assetImportPolicy';
import { importAssetBatch, type ImportAssetFromPathInput } from './assetImportTransaction';
import type { ProjectStore } from './projectStore';
import {
  ProjectStoreError,
  assertOpaqueId,
  isInsideDirectory,
  projectAssetPathWithinDirectory
} from './projectStoreSupport';

export { DEFAULT_ASSET_IMPORT_LIMITS } from './assetImportPolicy';
export type { ImportAssetFromPathInput } from './assetImportTransaction';

export type AssetPlaybackSource = {
  readonly filePath: string;
  readonly mimeType: string;
};

export type OpenedAssetPlaybackSource = AssetPlaybackSource & {
  readonly file: FileHandle;
  readonly byteLength: number;
};

export class AssetLibraryStore {
  private readonly rootDirectory: string;

  constructor(
    rootDirectory: string,
    private readonly projects: ProjectStore,
    private readonly importLimits: AssetImportLimits = DEFAULT_ASSET_IMPORT_LIMITS
  ) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async import(input: ImportAssetFromPathInput, now = new Date()): Promise<MediaAsset> {
    const imported = await this.importMany([input], now);
    const firstAsset = imported[0];
    if (firstAsset === undefined) {
      throw new ProjectStoreError('Asset batch returned no asset.');
    }
    return firstAsset;
  }

  async importMany(inputs: readonly ImportAssetFromPathInput[], now = new Date()): Promise<readonly MediaAsset[]> {
    return importAssetBatch({
      rootDirectory: this.rootDirectory,
      projects: this.projects,
      imports: inputs,
      limits: this.importLimits,
      now
    });
  }

  async updateMetadata(input: UpdateAssetMetadataInput, now = new Date()): Promise<MediaAsset> {
    return this.projects.updateAssetMetadata(input, now);
  }

  async getPlaybackSource(projectId: string, assetId: string): Promise<AssetPlaybackSource | null> {
    const source = await this.openPlaybackSource(projectId, assetId);
    if (source === null) {
      return null;
    }
    await source.file.close();
    return { filePath: source.filePath, mimeType: source.mimeType };
  }

  async openPlaybackSource(projectId: string, assetId: string): Promise<OpenedAssetPlaybackSource | null> {
    assertOpaqueId(projectId, 'project id');
    assertOpaqueId(assetId, 'asset id');
    const asset = await this.projects.getAsset(projectId, assetId);
    if (asset === null) {
      return null;
    }
    const projectPath = await this.projects.resolveDirectory(projectId);
    const filePath = projectAssetPathWithinDirectory(projectPath, asset.projectRelativePath);
    try {
      const projectStats = await lstat(projectPath);
      if (projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
        return null;
      }
      const projectRealPath = await realpath(projectPath);
      const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const [fileStats, filePathStats, fileRealPath, projectAfterOpen] = await Promise.all([
          file.stat(),
          lstat(filePath),
          realpath(filePath),
          lstat(projectPath)
        ]);
        const projectStayedStable =
          !projectAfterOpen.isSymbolicLink() &&
          projectAfterOpen.isDirectory() &&
          projectAfterOpen.dev === projectStats.dev &&
          projectAfterOpen.ino === projectStats.ino;
        const validSource = fileStats.isFile() &&
          !filePathStats.isSymbolicLink() &&
          filePathStats.isFile() &&
          filePathStats.dev === fileStats.dev &&
          filePathStats.ino === fileStats.ino &&
          fileStats.size === asset.byteLength &&
          isInsideDirectory(projectRealPath, fileRealPath) &&
          projectStayedStable;
        if (!validSource) {
          await file.close();
          return null;
        }
        return { file, filePath, mimeType: asset.mimeType, byteLength: fileStats.size };
      } catch (error) {
        await file.close();
        throw error;
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')) {
        return null;
      }
      throw error;
    }
  }

}
