import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { ExportJobActionInput, LocalExportJob, StartExportJobInput } from '../shared/exportTypes';
import type {
  AbortRecordingInput,
  ApiResponse,
  AppSettings,
  AppendRecordingChunkInput,
  AppendVoiceProfileSampleChunkInput,
  CaptureSource,
  ChunkAck,
  DeleteVoiceProfileInput,
  DiscardVoiceProfileSampleInput,
  FinishRecordingInput,
  FinalizeVoiceProfileSampleInput,
  GetTtsJobInput,
  LocalTtsJob,
  LocalTtsRuntimeStatus,
  RecordingResult,
  RecordingSession,
  ResultActionInput,
  SelectSourceInput,
  SourceAvailability,
  SourceAvailabilityInput,
  StartRecordingInput,
  StartTtsJobInput,
  StartVoiceProfileSampleInput,
  TtsJobActionInput,
  VoiceProfile,
  VoiceProfileSampleSession
} from '../shared/models';
import type {
  CreateProjectInput,
  DeleteProjectInput,
  GetAssetPlaybackUrlInput,
  ImportProjectAssetsInput,
  ImportRecordingResultAssetInput,
  ImportTtsResultAssetInput,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  OpenProjectInput,
  SaveTimelineInput,
  UpdateAssetMetadataInput
} from '../shared/timelineTypes';
import { parseTimelineMenuCommandId } from '../shared/timelineMenuCommands';
import type { TimelineMenuCommandId, TimelineMenuState } from '../shared/timelineMenuCommands';

type ImportProjectAssetsResult = {
  readonly assets: readonly MediaAsset[];
};

type AssetPlaybackUrl = {
  readonly url: string;
};

export interface VideoToolApi {
  onTimelineMenuCommand(listener: (commandId: TimelineMenuCommandId) => void): () => void;
  updateTimelineMenuState(state: TimelineMenuState): void;
  getSettings(): Promise<ApiResponse<AppSettings>>;
  listSources(): Promise<ApiResponse<CaptureSource[]>>;
  selectSource(input: SelectSourceInput): Promise<ApiResponse<CaptureSource>>;
  getSelectedSource(): Promise<ApiResponse<CaptureSource | null>>;
  checkSelectedSource(input: SourceAvailabilityInput): Promise<ApiResponse<SourceAvailability>>;
  startRecording(input: StartRecordingInput): Promise<ApiResponse<RecordingSession>>;
  appendRecordingChunk(input: AppendRecordingChunkInput): Promise<ApiResponse<ChunkAck>>;
  finishRecording(input: FinishRecordingInput): Promise<ApiResponse<RecordingResult>>;
  abortRecording(input: AbortRecordingInput): Promise<ApiResponse<{ aborted: boolean }>>;
  openResult(input: ResultActionInput): Promise<ApiResponse<{ opened: boolean }>>;
  revealResult(input: ResultActionInput): Promise<ApiResponse<{ revealed: boolean }>>;
  listVoiceProfiles(): Promise<ApiResponse<VoiceProfile[]>>;
  startVoiceProfile(input: StartVoiceProfileSampleInput): Promise<ApiResponse<VoiceProfileSampleSession>>;
  appendVoiceProfile(input: AppendVoiceProfileSampleChunkInput): Promise<ApiResponse<ChunkAck>>;
  finalizeVoiceProfile(input: FinalizeVoiceProfileSampleInput): Promise<ApiResponse<VoiceProfile>>;
  discardVoiceProfile(input: DiscardVoiceProfileSampleInput): Promise<ApiResponse<{ discarded: boolean }>>;
  deleteVoiceProfile(input: DeleteVoiceProfileInput): Promise<ApiResponse<{ deleted: boolean }>>;
  getTtsRuntimeStatus(): Promise<ApiResponse<LocalTtsRuntimeStatus>>;
  startTtsJob(input: StartTtsJobInput): Promise<ApiResponse<LocalTtsJob>>;
  getTtsJob(input: GetTtsJobInput): Promise<ApiResponse<LocalTtsJob>>;
  openTtsResult(input: TtsJobActionInput): Promise<ApiResponse<{ opened: boolean }>>;
  revealTtsResult(input: TtsJobActionInput): Promise<ApiResponse<{ revealed: boolean }>>;
  listProjects(): Promise<ApiResponse<readonly LocalProjectSummary[]>>;
  createProject(input: CreateProjectInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  openProject(input: OpenProjectInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  deleteProject(input: DeleteProjectInput): Promise<ApiResponse<{ readonly deleted: boolean }>>;
  importProjectAssets(input: ImportProjectAssetsInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  importRecordingResultAsset(input: ImportRecordingResultAssetInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  importTtsResultAsset(input: ImportTtsResultAssetInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  updateAssetMetadata(input: UpdateAssetMetadataInput): Promise<ApiResponse<MediaAsset>>;
  getAssetPlaybackUrl(input: GetAssetPlaybackUrlInput): Promise<ApiResponse<AssetPlaybackUrl>>;
  saveTimeline(input: SaveTimelineInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  startExportJob(input: StartExportJobInput): Promise<ApiResponse<LocalExportJob>>;
  getExportJob(input: ExportJobActionInput): Promise<ApiResponse<LocalExportJob>>;
  cancelExportJob(input: ExportJobActionInput): Promise<ApiResponse<{ readonly cancelled: boolean }>>;
  openExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly opened: boolean }>>;
  revealExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly revealed: boolean }>>;
  aiGenerateVideo(request: unknown): Promise<ApiResponse<unknown>>;
  aiGetVideoJob(jobId: string): Promise<ApiResponse<unknown>>;
  aiGenerateSpeech(request: unknown): Promise<ApiResponse<unknown>>;
  aiGetSpeechJob(jobId: string): Promise<ApiResponse<unknown>>;
  getProviderCredentialStatus(): Promise<ApiResponse<Record<string, boolean>>>;
  setProviderCredential(provider: string, apiKey: string): Promise<ApiResponse<{ readonly updated: boolean }>>;
  executeLlmPrompt(request: {
    modelId: string;
    prompt: string;
    systemPrompt?: string;
    ollamaBaseUrl?: string;
  }): Promise<ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>>;
}

const videoTool: VideoToolApi = {
  onTimelineMenuCommand: (listener) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      const commandId = parseTimelineMenuCommandId(payload);
      if (commandId !== null) listener(commandId);
    };
    ipcRenderer.on(IPC_CHANNELS.timelineMenuCommand, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.timelineMenuCommand, subscription);
  },
  updateTimelineMenuState: (state) => ipcRenderer.send(IPC_CHANNELS.timelineMenuState, state),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as Promise<ApiResponse<AppSettings>>,
  listSources: () => ipcRenderer.invoke(IPC_CHANNELS.listSources) as Promise<ApiResponse<CaptureSource[]>>,
  selectSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.selectSource, input) as Promise<ApiResponse<CaptureSource>>,
  getSelectedSource: () => ipcRenderer.invoke(IPC_CHANNELS.getSelectedSource) as Promise<ApiResponse<CaptureSource | null>>,
  checkSelectedSource: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkSelectedSource, input) as Promise<ApiResponse<SourceAvailability>>,
  startRecording: (input) => ipcRenderer.invoke(IPC_CHANNELS.startRecording, input) as Promise<ApiResponse<RecordingSession>>,
  appendRecordingChunk: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.appendRecordingChunk, input) as Promise<ApiResponse<ChunkAck>>,
  finishRecording: (input) => ipcRenderer.invoke(IPC_CHANNELS.finishRecording, input) as Promise<ApiResponse<RecordingResult>>,
  abortRecording: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.abortRecording, input) as Promise<ApiResponse<{ aborted: boolean }>>,
  openResult: (input) => ipcRenderer.invoke(IPC_CHANNELS.openResult, input) as Promise<ApiResponse<{ opened: boolean }>>,
  revealResult: (input) => ipcRenderer.invoke(IPC_CHANNELS.revealResult, input) as Promise<ApiResponse<{ revealed: boolean }>>,
  listVoiceProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesList) as Promise<ApiResponse<VoiceProfile[]>>,
  startVoiceProfile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesStart, input) as Promise<ApiResponse<VoiceProfileSampleSession>>,
  appendVoiceProfile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesAppend, input) as Promise<ApiResponse<ChunkAck>>,
  finalizeVoiceProfile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesFinalize, input) as Promise<ApiResponse<VoiceProfile>>,
  discardVoiceProfile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesDiscard, input) as Promise<ApiResponse<{ discarded: boolean }>>,
  deleteVoiceProfile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceProfilesDelete, input) as Promise<ApiResponse<{ deleted: boolean }>>,
  getTtsRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getTtsRuntimeStatus) as Promise<ApiResponse<LocalTtsRuntimeStatus>>,
  startTtsJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.startTtsJob, input) as Promise<ApiResponse<LocalTtsJob>>,
  getTtsJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.getTtsJob, input) as Promise<ApiResponse<LocalTtsJob>>,
  openTtsResult: (input) => ipcRenderer.invoke(IPC_CHANNELS.openTtsResult, input) as Promise<ApiResponse<{ opened: boolean }>>,
  revealTtsResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealTtsResult, input) as Promise<ApiResponse<{ revealed: boolean }>>,
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList) as Promise<ApiResponse<readonly LocalProjectSummary[]>>,
  createProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  openProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsOpen, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  deleteProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, input) as Promise<ApiResponse<{ readonly deleted: boolean }>>,
  importProjectAssets: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetsImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  importRecordingResultAsset: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecordingResultImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  importTtsResultAsset: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectTtsResultImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  updateAssetMetadata: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetMetadataUpdate, input) as Promise<ApiResponse<MediaAsset>>,
  getAssetPlaybackUrl: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetPlaybackUrl, input) as Promise<ApiResponse<AssetPlaybackUrl>>,
  saveTimeline: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectTimelineSave, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  startExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.startExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  getExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.getExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  cancelExportJob: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelExportJob, input) as Promise<ApiResponse<{ readonly cancelled: boolean }>>,
  openExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExportResult, input) as Promise<ApiResponse<{ readonly opened: boolean }>>,
  revealExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealExportResult, input) as Promise<ApiResponse<{ readonly revealed: boolean }>>,
  aiGenerateVideo: (request) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerateVideo, request) as Promise<ApiResponse<unknown>>,
  aiGetVideoJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.aiGetVideoJob, jobId) as Promise<ApiResponse<unknown>>,
  aiGenerateSpeech: (request) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerateSpeech, request) as Promise<ApiResponse<unknown>>,
  aiGetSpeechJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.aiGetSpeechJob, jobId) as Promise<ApiResponse<unknown>>,
  getProviderCredentialStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderCredentials) as Promise<ApiResponse<Record<string, boolean>>>,
  setProviderCredential: (provider, apiKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProviderCredential, provider, apiKey) as Promise<ApiResponse<{ readonly updated: boolean }>>,
  executeLlmPrompt: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeLlmPrompt, request) as Promise<
      ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>
    >
};

contextBridge.exposeInMainWorld('videoTool', videoTool);
