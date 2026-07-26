import { basename } from 'node:path';

import type { LocalTtsRuntimeStatus, LocalTtsJob, StartTtsJobInput, VoiceProfile, VoiceProfileSampleSession } from '../shared/models';
import { getDefaultDomainModelId, getDomainModel } from '../shared/aiDomainModels';
import { isNarrationSampleDurationValid } from '../shared/narrationLogic';
import { LocalQwenRunner, LocalTtsRunnerError, type LocalQwenRunInput, type LocalQwenRunResult } from './localQwenRunner';
import { type LocalTtsConfigLoadResult, type LocalTtsRunnerConfig, loadLocalTtsConfig } from './localTtsConfig';
import { LocalTtsJobStore } from './localTtsJobStore';
import { fail, ok } from './ipcResponses';
import type { CompletedResultAssetSource } from './resultAssetImportService';
import {
  parseAppendVoiceProfileSampleChunkInput,
  parseDeleteVoiceProfileInput,
  parseDiscardVoiceProfileSampleInput,
  parseFinalizeVoiceProfileSampleInput,
  parseStartTtsJobInput,
  parseStartVoiceProfileSampleInput,
  parseTtsJobActionInput
} from '../shared/validators';
import { VoiceProfileStore } from './voiceProfileStore';
import type { ApiResponse } from '../shared/models';

type RunnerLike = {
  run(input: LocalQwenRunInput): Promise<LocalQwenRunResult>;
};

type CompletedAudio = {
  readonly outputPath: string;
};

type VoiceTtsIpcServiceDependencies = {
  readonly voiceProfiles: VoiceProfileStore;
  readonly ttsJobs: LocalTtsJobStore;
  readonly audioRoot?: string;
  readonly loadConfig?: () => Promise<LocalTtsConfigLoadResult>;
  readonly createRunner?: (config: LocalTtsRunnerConfig, audioRoot: string) => RunnerLike;
  readonly runInBackground?: (task: () => Promise<void>) => void;
  readonly openPath?: (path: string) => Promise<string>;
  readonly revealPath?: (path: string) => void;
};

function safeRunnerFailure(error: unknown): string {
  if (error instanceof LocalTtsRunnerError) {
    switch (error.code) {
      case 'SPAWN_FAILED':
        return 'The local TTS runner could not be started.';
      case 'TIMEOUT':
        return 'The local TTS runner timed out.';
      case 'PROCESS_FAILED':
        return 'The local TTS runner failed while generating audio.';
      case 'OUTPUT_INVALID':
        return 'The local TTS runner did not create valid audio.';
      case 'INVALID_REQUEST':
        return 'The local TTS request could not be run.';
    }
  }
  return 'The local TTS job failed.';
}

function resolveLocalTtsModelId(requestedModelId: string | undefined): string {
  const modelId = requestedModelId ?? getDefaultDomainModelId('voice-generation');
  const model = getDomainModel('voice-generation', modelId);
  if (model === undefined || !model.available || model.providerId !== 'local_qwen' || model.executionPath !== 'local') {
    throw new Error(`Model ${modelId} is not available for local Qwen TTS.`);
  }
  return model.id;
}

export class VoiceTtsIpcService {
  private readonly completedAudio = new Map<string, CompletedAudio>();
  private ttsReserved = false;
  private readonly loadConfig: () => Promise<LocalTtsConfigLoadResult>;
  private readonly createRunner: (config: LocalTtsRunnerConfig, audioRoot: string) => RunnerLike;
  private readonly runInBackground: (task: () => Promise<void>) => void;
  private readonly openPath: (path: string) => Promise<string>;
  private readonly revealPath: (path: string) => void;
  private readonly audioRoot: string;

  constructor(private readonly dependencies: VoiceTtsIpcServiceDependencies) {
    this.loadConfig = dependencies.loadConfig ?? loadLocalTtsConfig;
    this.createRunner = dependencies.createRunner ?? ((config, audioRoot) => new LocalQwenRunner(config, audioRoot));
    this.runInBackground = dependencies.runInBackground ?? ((task) => void task());
    this.openPath = dependencies.openPath ?? (async () => '');
    this.revealPath = dependencies.revealPath ?? (() => undefined);
    this.audioRoot = dependencies.audioRoot ?? '';
  }

  async listVoiceProfiles(): Promise<ApiResponse<VoiceProfile[]>> {
    try {
      return ok(await this.dependencies.voiceProfiles.list());
    } catch (error: unknown) {
      return fail<VoiceProfile[]>('UNKNOWN_ERROR', 'Voice profiles could not be listed.');
    }
  }

  async startVoiceProfile(payload: unknown): Promise<ApiResponse<VoiceProfileSampleSession>> {
    const input = parseStartVoiceProfileSampleInput(payload);
    if (input === null) {
      return fail<VoiceProfileSampleSession>('INVALID_INPUT', 'The voice profile start payload was not valid.');
    }
    try {
      const started = await this.dependencies.voiceProfiles.begin(input);
      return ok({ voiceProfileId: started.voiceProfileId, sampleId: started.sampleId, createdAt: started.createdAt });
    } catch (error: unknown) {
      return fail<VoiceProfileSampleSession>('FILE_WRITE_FAILED', 'The voice profile sample could not be created.');
    }
  }

  async appendVoiceProfile(payload: unknown): Promise<ApiResponse<{ readonly sequence: number; readonly totalBytes: number }>> {
    const input = parseAppendVoiceProfileSampleChunkInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The voice profile chunk payload was not valid.');
    }
    try {
      return ok(await this.dependencies.voiceProfiles.append(input.sampleId, input.sequence, input.chunk));
    } catch (error: unknown) {
      return fail('SESSION_CLOSED', 'The voice profile sample is not writable.');
    }
  }

  async finalizeVoiceProfile(payload: unknown): Promise<ApiResponse<VoiceProfile>> {
    const input = parseFinalizeVoiceProfileSampleInput(payload);
    if (input === null || !isNarrationSampleDurationValid(input.durationMs)) {
      return fail<VoiceProfile>('INVALID_INPUT', 'The voice profile finalize payload was not valid.');
    }
    try {
      return ok((await this.dependencies.voiceProfiles.finalize(input.sampleId, input.durationMs)).profile);
    } catch (error: unknown) {
      return fail<VoiceProfile>('SESSION_NOT_FOUND', 'The voice profile sample could not be finalized.');
    }
  }

  async discardVoiceProfile(payload: unknown): Promise<ApiResponse<{ readonly discarded: boolean }>> {
    const input = parseDiscardVoiceProfileSampleInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The voice profile discard payload was not valid.');
    }
    await this.dependencies.voiceProfiles.discard(input.sampleId);
    return ok({ discarded: true });
  }

  async deleteVoiceProfile(payload: unknown): Promise<ApiResponse<{ readonly deleted: boolean }>> {
    const input = parseDeleteVoiceProfileInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The voice profile delete payload was not valid.');
    }
    await this.dependencies.voiceProfiles.delete(input.voiceProfileId);
    return ok({ deleted: true });
  }

  async getTtsRuntimeStatus(): Promise<ApiResponse<LocalTtsRuntimeStatus>> {
    return ok(this.dependencies.ttsJobs.getRuntimeStatus(await this.loadConfig(), 'en-US'));
  }

  async startTtsJob(payload: unknown): Promise<ApiResponse<LocalTtsJob>> {
    const input = parseStartTtsJobInput(payload);
    if (input === null) {
      return fail<LocalTtsJob>('INVALID_INPUT', 'The local TTS job payload was not valid.');
    }
    let modelId: string;
    try {
      modelId = resolveLocalTtsModelId(input.modelId);
    } catch (error: unknown) {
      return fail<LocalTtsJob>('INVALID_INPUT', error instanceof Error ? error.message : 'The selected local TTS model was not valid.');
    }
    const resolvedInput: StartTtsJobInput = { ...input, modelId };
    if (this.ttsReserved) {
      return fail<LocalTtsJob>('TTS_UNAVAILABLE', 'Local TTS is already processing a job.');
    }

    this.ttsReserved = true;
    let launched = false;
    try {
      const configuration = await this.loadConfig();
      if (configuration.kind === 'unavailable') {
        return fail<LocalTtsJob>('TTS_UNAVAILABLE', configuration.reason);
      }
      if (input.mimeType !== configuration.config.outputMimeType) {
        return fail<LocalTtsJob>('INVALID_INPUT', 'The requested audio format does not match the local TTS configuration.');
      }
      const sample = await this.dependencies.voiceProfiles.getRunnerSample(input.voiceProfileId).catch(() => null);
      if (sample === null) {
        return fail<LocalTtsJob>('PROFILE_NOT_FOUND', 'The selected voice profile was not found.');
      }
      const job = this.dependencies.ttsJobs.create(resolvedInput, configuration.config.modelId);
      this.runInBackground(() => this.runTtsJob(job.id, resolvedInput, sample.samplePath, configuration.config));
      launched = true;
      return ok(job);
    } finally {
      if (!launched) {
        this.ttsReserved = false;
      }
    }
  }

  async getTtsJob(payload: unknown): Promise<ApiResponse<LocalTtsJob>> {
    const input = parseTtsJobActionInput(payload);
    if (input === null) {
      return fail<LocalTtsJob>('INVALID_INPUT', 'The local TTS job lookup payload was not valid.');
    }
    const job = this.dependencies.ttsJobs.get(input.jobId);
    return job === null ? fail<LocalTtsJob>('JOB_NOT_FOUND', 'The local TTS job was not found.') : ok(job);
  }

  async openTtsResult(payload: unknown): Promise<ApiResponse<{ readonly opened: boolean }>> {
    const audio = this.getCompletedAudio(payload);
    if (!audio.ok) {
      return audio;
    }
    const openError = await this.openPath(audio.value.outputPath);
    return openError.length > 0 ? fail('UNKNOWN_ERROR', 'The generated audio could not be opened.') : ok({ opened: true });
  }

  async revealTtsResult(payload: unknown): Promise<ApiResponse<{ readonly revealed: boolean }>> {
    const audio = this.getCompletedAudio(payload);
    if (!audio.ok) {
      return audio;
    }
    this.revealPath(audio.value.outputPath);
    return ok({ revealed: true });
  }

  getCompletedAudioSource(jobId: string): CompletedResultAssetSource | null {
    const job = this.dependencies.ttsJobs.get(jobId);
    const audio = this.completedAudio.get(jobId);
    if (job?.state.kind !== 'completed' || audio === undefined) {
      return null;
    }
    return { sourcePath: audio.outputPath, displayName: basename(audio.outputPath), kind: 'audio', mimeType: job.mimeType };
  }

  private async runTtsJob(jobId: string, input: StartTtsJobInput, voiceSamplePath: string, config: LocalTtsRunnerConfig): Promise<void> {
    try {
      this.dependencies.ttsJobs.markRunning(jobId);
      const result = await this.createRunner(config, this.audioRoot).run({ ...input, voiceSamplePath });
      this.completedAudio.set(jobId, { outputPath: result.outputPath });
      this.dependencies.ttsJobs.markCompleted(jobId, result.assetId);
    } catch (error: unknown) {
      this.dependencies.ttsJobs.markFailed(jobId, safeRunnerFailure(error));
    } finally {
      this.ttsReserved = false;
    }
  }

  private getCompletedAudio(payload: unknown): ApiResponse<CompletedAudio> {
    const input = parseTtsJobActionInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The local TTS result action payload was not valid.');
    }
    const job = this.dependencies.ttsJobs.get(input.jobId);
    const audio = this.completedAudio.get(input.jobId);
    if (job?.state.kind !== 'completed' || audio === undefined) {
      return fail('TTS_RESULT_UNAVAILABLE', 'The generated audio result is not available.');
    }
    return ok(audio);
  }
}
