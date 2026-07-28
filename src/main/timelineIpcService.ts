import { extname, basename } from 'node:path';

import type { ApiResponse } from '../shared/models';
import type {
  CreateProjectInput,
  CreateProjectResult,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  MediaKind,
  OpenProjectFolderResult
} from '../shared/timelineTypes';
import {
  parseCreateProjectInput,
  parseDeleteProjectInput,
  parseGetAssetPlaybackUrlInput,
  parseImportProjectAssetsInput,
  parseListProjectsInput,
  parseOpenProjectInput,
  parseSaveTimelineInput,
  parseUpdateAssetMetadataInput
} from '../shared/timelineValidators';
import {
  AssetLibraryStore,
  type AssetPlaybackSource,
  type ImportAssetFromPathInput,
  type OpenedAssetPlaybackSource
} from './assetLibraryStore';
import { AssetImportValidationError, assertAssetSelectionCount, DEFAULT_ASSET_IMPORT_LIMITS } from './assetImportPolicy';
import { supportedAssetDialogExtensions, supportedAssetFormatForExtension } from './assetLibrarySupport';
import { fail, ok } from './ipcResponses';
import { ProjectStore } from './projectStore';
import { ProjectStoreError } from './projectStoreSupport';

type NativeFileDialogResult = {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
};

type TimelineIpcServiceDependencies = {
  readonly projects: ProjectStore;
  readonly assets: AssetLibraryStore;
  readonly selectMediaFiles?: (input: ImportProjectAssetsDialogInput) => Promise<NativeFileDialogResult>;
  readonly selectProjectDirectory?: () => Promise<NativeFileDialogResult>;
};

type ImportProjectAssetsDialogInput = {
  readonly acceptedKinds?: readonly MediaKind[];
  readonly extensions: readonly string[];
};

type ImportProjectAssetsResult = {
  readonly assets: readonly MediaAsset[];
};

type AssetPlaybackUrl = {
  readonly url: string;
};

function projectMissing(projectId: string): ApiResponse<LocalProjectSnapshot> {
  return fail('PROJECT_NOT_FOUND', `Project ${projectId} was not found.`);
}

function safeProjectError<T>(error: unknown, code: 'UNKNOWN_ERROR' | 'FILE_WRITE_FAILED', message: string): ApiResponse<T> {
  return error instanceof ProjectStoreError ? fail(code, error.message) : fail(code, message);
}

export class TimelineIpcService {
  private readonly selectMediaFiles: (input: ImportProjectAssetsDialogInput) => Promise<NativeFileDialogResult>;
  private readonly selectProjectDirectory: () => Promise<NativeFileDialogResult>;

  constructor(private readonly dependencies: TimelineIpcServiceDependencies) {
    this.selectMediaFiles = dependencies.selectMediaFiles ?? (async () => ({ canceled: true, filePaths: [] }));
    this.selectProjectDirectory = dependencies.selectProjectDirectory ?? (async () => ({ canceled: true, filePaths: [] }));
  }

  async listProjects(payload: unknown): Promise<ApiResponse<readonly LocalProjectSummary[]>> {
    if (parseListProjectsInput(payload) === null) {
      return fail('INVALID_INPUT', 'The project list payload was not valid.');
    }
    try {
      return ok(await this.dependencies.projects.list());
    } catch (error: unknown) {
      return safeProjectError(error, 'UNKNOWN_ERROR', 'Projects could not be listed.');
    }
  }

  async createProject(payload: unknown): Promise<ApiResponse<CreateProjectResult>> {
    const input: CreateProjectInput | null = parseCreateProjectInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The project creation payload was not valid.');
    }
    try {
      const dialogResult = await this.selectProjectDirectory();
      const parentDirectory = dialogResult.filePaths[0];
      if (dialogResult.canceled || parentDirectory === undefined) {
        return ok({ cancelled: true });
      }
      const project = await this.dependencies.projects.createInFolder({ name: input.name, parentDirectory });
      return ok({ cancelled: false, project });
    } catch (error: unknown) {
      return safeProjectError(error, 'FILE_WRITE_FAILED', 'The project could not be created.');
    }
  }

  async openProjectFolder(payload: unknown): Promise<ApiResponse<OpenProjectFolderResult>> {
    if (payload !== undefined && (typeof payload !== 'object' || payload === null)) {
      return fail('INVALID_INPUT', 'The project folder payload was not valid.');
    }
    try {
      const dialogResult = await this.selectProjectDirectory();
      const directory = dialogResult.filePaths[0];
      if (dialogResult.canceled || directory === undefined) {
        return ok({ cancelled: true });
      }
      const result = await this.dependencies.projects.openOrInitializeFolder(directory);
      if (result === null) {
        return fail('INVALID_INPUT', 'The selected folder has a project file that could not be read, so it was left untouched.');
      }
      return ok({ cancelled: false, created: result.created, project: result.project });
    } catch (error: unknown) {
      return safeProjectError(error, 'UNKNOWN_ERROR', 'The project folder could not be opened.');
    }
  }

  async openProject(payload: unknown): Promise<ApiResponse<LocalProjectSnapshot>> {
    const input = parseOpenProjectInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The project lookup payload was not valid.');
    }
    try {
      const project = await this.dependencies.projects.open(input.projectId);
      return project === null ? projectMissing(input.projectId) : ok(project);
    } catch (error: unknown) {
      return safeProjectError(error, 'UNKNOWN_ERROR', 'The project could not be opened.');
    }
  }

  async deleteProject(payload: unknown): Promise<ApiResponse<{ readonly deleted: boolean }>> {
    const input = parseDeleteProjectInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The project delete payload was not valid.');
    }
    try {
      return ok({ deleted: await this.dependencies.projects.delete(input.projectId) });
    } catch (error: unknown) {
      return safeProjectError(error, 'UNKNOWN_ERROR', 'The project could not be deleted.');
    }
  }

  async importProjectAssets(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportProjectAssetsInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The media import payload was not valid.');
    }
    try {
      const dialogInput: ImportProjectAssetsDialogInput = input.acceptedKinds === undefined
        ? { extensions: supportedAssetDialogExtensions() }
        : { acceptedKinds: input.acceptedKinds, extensions: supportedAssetDialogExtensions() };
      const selectedFiles = await this.selectMediaFiles(dialogInput);
      if (selectedFiles.canceled) {
        return ok({ assets: [] });
      }
      assertAssetSelectionCount(selectedFiles.filePaths.length, DEFAULT_ASSET_IMPORT_LIMITS);
      const imports = selectedFiles.filePaths.map((sourcePath) =>
        this.createSelectedAssetInput(input.projectId, input.acceptedKinds, sourcePath)
      );
      return ok({ assets: await this.dependencies.assets.importMany(imports) });
    } catch (error: unknown) {
      if (error instanceof AssetImportValidationError) {
        return fail('INVALID_INPUT', error.message);
      }
      return safeProjectError(error, 'FILE_WRITE_FAILED', 'Selected media could not be imported.');
    }
  }

  async updateAssetMetadata(payload: unknown): Promise<ApiResponse<MediaAsset>> {
    const input = parseUpdateAssetMetadataInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The asset metadata payload was not valid.');
    }
    try {
      return ok(await this.dependencies.assets.updateMetadata(input));
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError && error.message.startsWith('Asset ')) {
        return fail('ASSET_NOT_FOUND', 'The requested asset is not available.');
      }
      return safeProjectError(error, 'UNKNOWN_ERROR', 'The asset metadata could not be updated.');
    }
  }

  async saveTimeline(payload: unknown): Promise<ApiResponse<LocalProjectSnapshot>> {
    const input = parseSaveTimelineInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The timeline save payload was not valid.');
    }
    try {
      return ok(await this.dependencies.projects.saveTimeline(input.projectId, input.timeline));
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError) {
        return fail('INVALID_INPUT', error.message);
      }
      return safeProjectError(error, 'UNKNOWN_ERROR', 'The timeline could not be saved.');
    }
  }

  async getAssetPlaybackUrl(payload: unknown): Promise<ApiResponse<AssetPlaybackUrl>> {
    const input = parseGetAssetPlaybackUrlInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The asset playback payload was not valid.');
    }
    const playbackSource = await this.resolveAssetPlaybackSource(input.projectId, input.assetId);
    return playbackSource === null
      ? fail('ASSET_NOT_FOUND', 'The requested asset is not available for playback.')
      : ok({ url: `video-tool-asset://playback/${input.projectId}/${input.assetId}` });
  }

  async resolveAssetPlaybackSource(projectId: string, assetId: string): Promise<AssetPlaybackSource | null> {
    return this.dependencies.assets.getPlaybackSource(projectId, assetId);
  }

  async openAssetPlaybackSource(projectId: string, assetId: string): Promise<OpenedAssetPlaybackSource | null> {
    return this.dependencies.assets.openPlaybackSource(projectId, assetId);
  }

  private createSelectedAssetInput(
    projectId: string,
    acceptedKinds: readonly MediaKind[] | undefined,
    sourcePath: string
  ): ImportAssetFromPathInput {
    const format = supportedAssetFormatForExtension(extname(sourcePath).toLowerCase(), acceptedKinds?.length === 1 ? acceptedKinds[0] : undefined);
    if (format === null || (acceptedKinds !== undefined && !acceptedKinds.includes(format.kind))) {
      throw new AssetImportValidationError('A selected media file is not supported.');
    }
    return {
      projectId,
      sourcePath,
      displayName: basename(sourcePath),
      kind: format.kind,
      mimeType: format.mimeType
    };
  }
}
