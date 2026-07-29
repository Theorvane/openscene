import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { ExportJobActionInput, LocalExportJob, LocalFfmpegRuntimeStatus, StartExportJobInput } from '../shared/exportTypes';
import type { ReferenceImageSelection, TextToSpeechJob, TextToSpeechRequest, VideoGenerationJob, VideoGenerationRequest } from '../shared/providerSeams';
import type {
  AbortRecordingInput,
  ApiResponse,
  AppSettings,
  AppendRecordingChunkInput,
  CaptureSource,
  ChunkAck,
  FinishRecordingInput,
  RecordingResult,
  RecordingSession,
  ResultActionInput,
  SelectSourceInput,
  SourceAvailability,
  SourceAvailabilityInput,
  StartRecordingInput
} from '../shared/models';
import type {
  CreateProjectInput,
  CreateProjectResult,
  DeleteProjectInput,
  GetAssetPlaybackUrlInput,
  ImportProjectAssetsInput,
  ImportRecordingResultAssetInput,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  OpenProjectFolderResult,
  OpenProjectInput,
  SaveTimelineInput,
  UpdateAssetMetadataInput
} from '../shared/timelineTypes';
import { parseTimelineMenuCommandId } from '../shared/timelineMenuCommands';
import type { TimelineMenuCommandId, TimelineMenuState } from '../shared/timelineMenuCommands';
import type {
  AgentChatApprovalInput,
  AgentChatHistoryEntry,
  AgentChatHistoryGetInput,
  AgentChatResetInput,
  AgentChatSendInput,
  AgentChatStoredConversation,
  AgentChatTurnState
} from '../shared/agentChat';
import type { ChatGptOAuthStatus, OpenAiAuthMode } from '../shared/openAiAuth';

type ImportProjectAssetsResult = {
  readonly assets: readonly MediaAsset[];
};

type AssetPlaybackUrl = {
  readonly url: string;
};

export interface VideoToolApi {
  onTimelineMenuCommand(listener: (commandId: TimelineMenuCommandId) => void): () => void;
  onProjectTimelineChanged(listener: (projectId: string) => void): () => void;
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
  listProjects(): Promise<ApiResponse<readonly LocalProjectSummary[]>>;
  createProject(input: CreateProjectInput): Promise<ApiResponse<CreateProjectResult>>;
  openProject(input: OpenProjectInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  openProjectFolder(): Promise<ApiResponse<OpenProjectFolderResult>>;
  deleteProject(input: DeleteProjectInput): Promise<ApiResponse<{ readonly deleted: boolean }>>;
  importProjectAssets(input: ImportProjectAssetsInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  importRecordingResultAsset(input: ImportRecordingResultAssetInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  importAiResultAsset(input: { projectId: string; jobId: string }): Promise<ApiResponse<ImportProjectAssetsResult>>;
  updateAssetMetadata(input: UpdateAssetMetadataInput): Promise<ApiResponse<MediaAsset>>;
  getAssetPlaybackUrl(input: GetAssetPlaybackUrlInput): Promise<ApiResponse<AssetPlaybackUrl>>;
  saveTimeline(input: SaveTimelineInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  getFfmpegRuntimeStatus(): Promise<ApiResponse<LocalFfmpegRuntimeStatus>>;
  startExportJob(input: StartExportJobInput): Promise<ApiResponse<LocalExportJob>>;
  getExportJob(input: ExportJobActionInput): Promise<ApiResponse<LocalExportJob>>;
  cancelExportJob(input: ExportJobActionInput): Promise<ApiResponse<{ readonly cancelled: boolean }>>;
  openExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly opened: boolean }>>;
  revealExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly revealed: boolean }>>;
  aiGenerateVideo(request: VideoGenerationRequest): Promise<ApiResponse<VideoGenerationJob>>;
  aiSelectReferenceImage(): Promise<ApiResponse<ReferenceImageSelection | null>>;
  aiGetVideoJob(jobId: string): Promise<ApiResponse<VideoGenerationJob>>;
  aiGenerateSpeech(request: TextToSpeechRequest): Promise<ApiResponse<TextToSpeechJob>>;
  aiGetSpeechJob(jobId: string): Promise<ApiResponse<TextToSpeechJob>>;
  getProviderCredentialStatus(): Promise<ApiResponse<Record<string, boolean>>>;
  setProviderCredential(provider: string, apiKey: string): Promise<ApiResponse<{ readonly updated: boolean }>>;
  getChatGptOAuthStatus(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  startChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  cancelChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  logoutChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  executeLlmPrompt(request: {
    modelId: string;
    prompt: string;
    systemPrompt?: string;
    ollamaBaseUrl?: string;
    openAiAuthMode?: OpenAiAuthMode;
  }): Promise<ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>>;
  mcpGetTools(): Promise<ApiResponse<unknown>>;
  mcpExecuteTool(toolName: string, params: unknown): Promise<ApiResponse<unknown>>;
  agentChatSend(input: AgentChatSendInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatApprove(input: AgentChatApprovalInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatReset(input: AgentChatResetInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatHistoryList(): Promise<ApiResponse<readonly AgentChatHistoryEntry[]>>;
  agentChatHistoryGet(input: AgentChatHistoryGetInput): Promise<ApiResponse<AgentChatStoredConversation | null>>;
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
  onProjectTimelineChanged: (listener) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      const projectId = (payload as { projectId?: unknown } | null)?.projectId;
      if (typeof projectId === 'string' && projectId.length > 0) listener(projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.projectTimelineChanged, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.projectTimelineChanged, subscription);
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
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList) as Promise<ApiResponse<readonly LocalProjectSummary[]>>,
  createProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input) as Promise<ApiResponse<CreateProjectResult>>,
  openProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsOpen, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  openProjectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.projectsOpenFolder) as Promise<ApiResponse<OpenProjectFolderResult>>,
  deleteProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, input) as Promise<ApiResponse<{ readonly deleted: boolean }>>,
  importProjectAssets: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetsImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  importRecordingResultAsset: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecordingResultImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  importAiResultAsset: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAiResultImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  updateAssetMetadata: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetMetadataUpdate, input) as Promise<ApiResponse<MediaAsset>>,
  getAssetPlaybackUrl: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetPlaybackUrl, input) as Promise<ApiResponse<AssetPlaybackUrl>>,
  saveTimeline: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectTimelineSave, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  getFfmpegRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getFfmpegRuntimeStatus) as Promise<ApiResponse<LocalFfmpegRuntimeStatus>>,
  startExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.startExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  getExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.getExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  cancelExportJob: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelExportJob, input) as Promise<ApiResponse<{ readonly cancelled: boolean }>>,
  openExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExportResult, input) as Promise<ApiResponse<{ readonly opened: boolean }>>,
  revealExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealExportResult, input) as Promise<ApiResponse<{ readonly revealed: boolean }>>,
  aiGenerateVideo: (request) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerateVideo, request) as Promise<ApiResponse<VideoGenerationJob>>,
  aiSelectReferenceImage: () => ipcRenderer.invoke(IPC_CHANNELS.aiSelectReferenceImage) as Promise<ApiResponse<ReferenceImageSelection | null>>,
  aiGetVideoJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.aiGetVideoJob, jobId) as Promise<ApiResponse<VideoGenerationJob>>,
  aiGenerateSpeech: (request) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerateSpeech, request) as Promise<ApiResponse<TextToSpeechJob>>,
  aiGetSpeechJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.aiGetSpeechJob, jobId) as Promise<ApiResponse<TextToSpeechJob>>,
  getProviderCredentialStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderCredentials) as Promise<ApiResponse<Record<string, boolean>>>,
  setProviderCredential: (provider, apiKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProviderCredential, provider, apiKey) as Promise<ApiResponse<{ readonly updated: boolean }>>,
  getChatGptOAuthStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getChatGptOAuthStatus) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  startChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.startChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  cancelChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  logoutChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.logoutChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  executeLlmPrompt: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeLlmPrompt, request) as Promise<
      ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>
    >,
  mcpGetTools: () => ipcRenderer.invoke(IPC_CHANNELS.mcpGetTools) as Promise<ApiResponse<unknown>>,
  mcpExecuteTool: (toolName: string, params: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpExecuteTool, toolName, params) as Promise<ApiResponse<unknown>>,
  agentChatSend: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentChatSend, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatApprove: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatApprove, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatReset: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentChatReset, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatHistoryList: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatHistoryList) as Promise<ApiResponse<readonly AgentChatHistoryEntry[]>>,
  agentChatHistoryGet: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatHistoryGet, input) as Promise<ApiResponse<AgentChatStoredConversation | null>>
};

contextBridge.exposeInMainWorld('videoTool', videoTool);
