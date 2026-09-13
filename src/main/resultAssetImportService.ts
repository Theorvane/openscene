import { randomUUID } from 'node:crypto';

import type { ApiResponse } from '../shared/models';
import { resultAssetOriginKey, type ImportProjectAssetsResult, type ImportRecordingResultAssetInput, type ImportTtsResultAssetInput, type MediaKind, type ResultAssetOrigin } from '../shared/timelineTypes';
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

function inputFromSource(projectId: string, source: CompletedResultAssetSource, resultOrigin: ResultAssetOrigin) {
  return {
    projectId,
    sourcePath: source.sourcePath,
    displayName: source.displayName,
    kind: source.kind,
    mimeType: source.mimeType,
    resultOrigin
  };
}

function importErrorDetails(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { error: 'Unknown import failure.' };
  const systemError = error as Error & { code?: unknown; syscall?: unknown; errno?: unknown; path?: unknown; dest?: unknown };
  const containsFilePath = typeof systemError.path === 'string' || typeof systemError.dest === 'string';
  return {
    error: containsFilePath
      ? `${typeof systemError.code === 'string' ? systemError.code : error.name}: ${typeof systemError.syscall === 'string' ? systemError.syscall : 'filesystem operation'}`
      : error.message,
    errorName: error.name,
    ...(typeof systemError.code === 'string' ? { code: systemError.code } : {}),
    ...(typeof systemError.syscall === 'string' ? { syscall: systemError.syscall } : {}),
    ...(typeof systemError.errno === 'number' ? { errno: systemError.errno } : {})
  };
}

export class ResultAssetImportService {
  private readonly inFlight = new Map<string, Promise<ApiResponse<ImportProjectAssetsResult>>>();

  constructor(private readonly dependencies: ResultAssetImportDependencies) {}

  async importRecordingResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportRecordingResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The recording result import payload was not valid.');
    }
    return this.importResult(
      input,
      { kind: 'recording', resultId: input.sessionId },
      () => this.dependencies.resolveRecordingSource(input.sessionId),
      'recording',
      { code: 'SESSION_NOT_FOUND', message: 'The completed recording result is not available.' },
      'The completed recording result could not be imported.'
    );
  }

  async importAiResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportTtsResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The AI result import payload was not valid.');
    }
    return this.importResult(
      input,
      { kind: 'ai-generation', resultId: input.jobId },
      () => this.dependencies.resolveAiSource(input.jobId),
      'ai-generation',
      { code: 'TTS_RESULT_UNAVAILABLE', message: 'The completed AI generation result is not available.' },
      'The completed AI generation result could not be imported.'
    );
  }

  private importResult(
    input: ImportRecordingResultAssetInput | ImportTtsResultAssetInput,
    resultOrigin: ResultAssetOrigin,
    resolveSource: () => CompletedResultAssetSource | null,
    resultKind: 'recording' | 'ai-generation',
    unavailable: { readonly code: 'SESSION_NOT_FOUND' | 'TTS_RESULT_UNAVAILABLE'; readonly message: string },
    failureMessage: string
  ): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const importKey = JSON.stringify([input.projectId, resultAssetOriginKey(resultOrigin)]);
    const active = this.inFlight.get(importKey);
    if (active !== undefined) return active;
    const operation = this.performImport(input, resultOrigin, resolveSource, resultKind, unavailable, failureMessage);
    this.inFlight.set(importKey, operation);
    const clearInFlight = () => {
      if (this.inFlight.get(importKey) === operation) this.inFlight.delete(importKey);
    };
    void operation.then(clearInFlight, clearInFlight);
    return operation;
  }

  private async performImport(
    input: ImportRecordingResultAssetInput | ImportTtsResultAssetInput,
    resultOrigin: ResultAssetOrigin,
    resolveSource: () => CompletedResultAssetSource | null,
    resultKind: 'recording' | 'ai-generation',
    unavailable: { readonly code: 'SESSION_NOT_FOUND' | 'TTS_RESULT_UNAVAILABLE'; readonly message: string },
    failureMessage: string
  ): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    try {
      const existing = await this.dependencies.assets.findByResultOrigin(input.projectId, resultOrigin);
      if (existing !== null) {
        console.info(`[OpenScene][Result Import][${requestId}] request.reused ${JSON.stringify({ resultKind, projectId: input.projectId, elapsedMs: Date.now() - startedAt })}`);
        return ok({ assets: [existing] });
      }
      const source = resolveSource();
      if (source === null) return fail(unavailable.code, unavailable.message);
      console.info(`[OpenScene][Result Import][${requestId}] request.start ${JSON.stringify({ resultKind, projectId: input.projectId, mediaKind: source.kind, mimeType: source.mimeType })}`);
      const assets = await this.dependencies.assets.importMany([inputFromSource(input.projectId, source, resultOrigin)]);
      console.info(`[OpenScene][Result Import][${requestId}] request.completed ${JSON.stringify({ elapsedMs: Date.now() - startedAt, assets: assets.length })}`);
      return ok({ assets });
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError && error.message === 'That completed result is already registered in this project.') {
        const existing = await this.dependencies.assets.findByResultOrigin(input.projectId, resultOrigin);
        if (existing !== null) {
          console.info(`[OpenScene][Result Import][${requestId}] request.reused ${JSON.stringify({ resultKind, projectId: input.projectId, elapsedMs: Date.now() - startedAt, concurrent: true })}`);
          return ok({ assets: [existing] });
        }
      }
      console.error(`[OpenScene][Result Import][${requestId}] request.failed ${JSON.stringify({ elapsedMs: Date.now() - startedAt, ...importErrorDetails(error) })}`);
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
