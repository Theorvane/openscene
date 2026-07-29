import type { ApiResponse } from '../shared/models';
import type { ImportProjectAssetsResult, ImportRecordingResultAssetInput, ImportTtsResultAssetInput, MediaKind } from '../shared/timelineTypes';
import { parseImportRecordingResultAssetInput, parseImportTtsResultAssetInput } from '../shared/timelineValidators';
import { AssetImportValidationError } from './assetImportPolicy';
import type { AssetLibraryStore } from './assetLibraryStore';
import { fail, ok } from './ipcResponses';
import { ProjectStoreError } from './projectStoreSupport';

export type CompletedResultAssetSource = {
  readonly sourcePath: string;
  readonly displayName: string;
  readonly kind: MediaKind;
  readonly mimeType: string;
};

export type ResultAssetImportDependencies = {
  readonly assets: AssetLibraryStore;
  readonly resolveRecordingSource: (sessionId: string) => CompletedResultAssetSource | null;
  /** Completed cloud voice/video generation jobs. */
  readonly resolveAiSource: (jobId: string) => CompletedResultAssetSource | null;
};

function inputFromSource(projectId: string, source: CompletedResultAssetSource) {
  return {
    projectId,
    sourcePath: source.sourcePath,
    displayName: source.displayName,
    kind: source.kind,
    mimeType: source.mimeType
  };
}

export class ResultAssetImportService {
  constructor(private readonly dependencies: ResultAssetImportDependencies) {}

  async importRecordingResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportRecordingResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The recording result import payload was not valid.');
    }
    const source = this.dependencies.resolveRecordingSource(input.sessionId);
    if (source === null) {
      return fail('SESSION_NOT_FOUND', 'The completed recording result is not available.');
    }
    return this.importResult(input, source, 'The completed recording result could not be imported.');
  }

  async importAiResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportTtsResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The AI result import payload was not valid.');
    }
    const source = this.dependencies.resolveAiSource(input.jobId);
    if (source === null) {
      return fail('TTS_RESULT_UNAVAILABLE', 'The completed AI generation result is not available.');
    }
    return this.importResult(input, source, 'The completed AI generation result could not be imported.');
  }

  private async importResult(
    input: ImportRecordingResultAssetInput | ImportTtsResultAssetInput,
    source: CompletedResultAssetSource,
    failureMessage: string
  ): Promise<ApiResponse<ImportProjectAssetsResult>> {
    try {
      return ok({ assets: await this.dependencies.assets.importMany([inputFromSource(input.projectId, source)]) });
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError && error.message.startsWith('Project ')) {
        return fail('PROJECT_NOT_FOUND', error.message);
      }
      if (error instanceof AssetImportValidationError) {
        return fail('INVALID_INPUT', error.message);
      }
      return fail('FILE_WRITE_FAILED', failureMessage);
    }
  }
}
