import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { AssetLibraryStore } from './assetLibraryStore';
import type { AppSettings, CaptureSource } from '../shared/models';
import type { MediaKind } from '../shared/timelineTypes';
import { SourceCatalog, type RawCaptureSource } from '../shared/sourceCatalog';
import { registerCaptureIpcHandlers } from './captureIpcHandlers';
import { ExportIpcService } from './exportIpcService';
import { registerExportIpcHandlers } from './exportIpcHandlers';
import { ExportJobStore } from './exportJobStore';
import { ProjectLocationRegistry } from './projectLocations';
import { GenerationSpendStore } from './generationSpendStore';
import { ProjectStore } from './projectStore';
import { RecordingFileStore } from './recordingStore';
import { registerResultAssetImportHandlers } from './resultAssetImportHandlers';
import { registerUpdaterIpcHandlers } from './updaterIpcHandlers';
import { setupUpdater } from './updater';
import { promptForUpdate, promptForUpdateState } from './updaterPrompt';
import { REFERENCE_IMAGE_EXTENSIONS, selectReferenceImage } from './referenceImagePicker';
import { ResultAssetImportService } from './resultAssetImportService';
import { registerTimelineAssetProtocol, registerTimelineAssetScheme } from './timelineAssetProtocol';
import { registerTimelineIpcHandlers } from './timelineIpcHandlers';
import { TimelineIpcService } from './timelineIpcService';
import { resolvePreloadScriptPath } from './preloadPath';
import { fail, ok } from './ipcResponses';
import { IPC_CHANNELS } from '../shared/ipc';
import { installApplicationMenu } from './applicationMenu';

import { createImageGenerationJob, createSpeechGenerationJob, createVideoGenerationJob, getCompletedAiSource, getGeneratedImageAsReference, getImageGenerationJob, getSpeechGenerationJob, getVideoGenerationJob, setAiJobManagerCredentialStore, setAiJobManagerSpendStore } from './aiJobManager';
import { CredentialStore } from './credentialStore';
import { LlmExecutionAdapter } from './llmAdapter';
import { getOpenVideoMcpDefinition, OpenVideoMcpServer } from './openVideoMcpServer';
import { AGENT_CHAT_SPEND_TOOL_NAMES, agentChatMutatingToolNames, createAgentChatTools } from './agentChatTools';
import { buildAgentChatGraph } from './agentChatGraph';
import { AgentChatSessionManager } from './agentChatSession';
import { createAgentChatModel } from './agentChatModel';
import { registerAgentChatIpcHandlers } from './agentChatIpcHandlers';
import { AgentChatHistoryStore } from './agentChatHistoryStore';
import { ChatGptOAuthService } from './chatGptOAuthService';
import { registerChatGptOAuthIpcHandlers } from './registerChatGptOAuthIpcHandlers';
import { ChatGptCodexAdapter } from './chatGptCodexAdapter';
import { LlmPromptRouter } from './llmPromptRouter';
import { registerLlmPromptIpcHandler } from './registerLlmPromptIpcHandler';

registerTimelineAssetScheme();

const sourceCatalog = new SourceCatalog();
const recordingStore = new RecordingFileStore(resolveRecordingsDirectory());
const projectLocations = new ProjectLocationRegistry(join(app.getPath('userData'), 'project-locations.json'));
const projectStore = new ProjectStore(join(app.getPath('userData'), 'projects'), projectLocations);
const assetLibraryStore = new AssetLibraryStore(join(app.getPath('userData'), 'projects'), projectStore);
const exportJobStore = new ExportJobStore();
const credentialStore = new CredentialStore(app.getPath('userData'));
const updaterController = setupUpdater();
const updaterPromptIo = {
  showMessageBox: (input: Parameters<typeof dialog.showMessageBox>[0]) => dialog.showMessageBox(input),
  openExternal: (url: string) => shell.openExternal(url)
};
const chatGptOAuthService = new ChatGptOAuthService(app.getPath('userData'), {
  openExternal: (url) => shell.openExternal(url)
});
const llmExecutionAdapter = new LlmExecutionAdapter(credentialStore);
const llmPromptRouter = new LlmPromptRouter({
  apiKeyAdapter: llmExecutionAdapter,
  chatGptAdapter: new ChatGptCodexAdapter({ oauthService: chatGptOAuthService })
});
setAiJobManagerCredentialStore(credentialStore);
/*
  The ceiling on what generation may cost, and the record of what it did.

  Kept in userData rather than in memory because the point of a monthly limit
  is that it survives the app closing: a loop restarted after a crash would
  otherwise begin again from zero.
*/
const generationSpendStore = new GenerationSpendStore(join(app.getPath('userData'), 'generation-spend.json'));
setAiJobManagerSpendStore(generationSpendStore);
const timelineIpcService = new TimelineIpcService({
  projects: projectStore,
  assets: assetLibraryStore,
  selectMediaFiles: ({ acceptedKinds, extensions }) => dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: dialogFilters(acceptedKinds, extensions)
  }),
  selectProjectDirectory: () => dialog.showOpenDialog({
    title: 'Choose a project folder',
    properties: ['openDirectory', 'createDirectory']
  })
});
const resultAssetImportService = new ResultAssetImportService({
  assets: assetLibraryStore,
  resolveRecordingSource: (sessionId) => {
    const result = recordingStore.getResult(sessionId);
    return result === null
      ? null
      : { sourcePath: result.outputPath, displayName: result.fileName, kind: 'video', mimeType: 'video/webm' };
  },
  resolveAiSource: (jobId) => getCompletedAiSource(jobId)
});
const exportIpcService = new ExportIpcService({
  projects: projectStore,
  assets: assetLibraryStore,
  jobs: exportJobStore,
  exportsRoot: join(app.getPath('userData'), 'exports'),
  openPath: (path) => shell.openPath(path),
  revealPath: (path) => shell.showItemInFolder(path)
});

function resolveRecordingsDirectory(): string {
  const override = process.env.VIDEO_TOOL_RECORDINGS_DIR;
  if (typeof override === 'string' && override.trim().length > 0) {
    return override;
  }

  return join(app.getPath('userData'), 'recordings');
}

function dialogFilters(acceptedKinds: readonly MediaKind[] | undefined, extensions: readonly string[]): Electron.FileFilter[] {
  if (acceptedKinds?.length === 1 && acceptedKinds[0] === 'audio') {
    return [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav', 'webm'] }];
  }
  if (acceptedKinds?.length === 1 && acceptedKinds[0] === 'video') {
    return [{ name: 'Video', extensions: ['mov', 'mp4', 'webm'] }];
  }
  return [{ name: 'Media', extensions: [...extensions] }];
}

function getScreenPermissionStatus(): string {
  if (process.platform !== 'darwin') {
    return 'not-required-by-platform';
  }

  return systemPreferences.getMediaAccessStatus('screen');
}

/**
 * Application identity set in code rather than inferred from package metadata.
 * macOS reads the application-menu title from the running bundle, so a dev run
 * still shows Electron; this is what a packaged build and the About panel use.
 */
const APP_NAME = 'OpenScene';

/** Window icon for platforms that take one; macOS uses the bundle icon. */
function appIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png');
  return existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: APP_NAME,
    ...(appIconPath() === undefined ? {} : { icon: appIconPath() as string }),
    backgroundColor: '#10100f',
    show: false,
    // macOS: hide the native titlebar so the renderer's product chrome acts as
    // the draggable top bar; traffic lights are repositioned to center in it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 15 } }
      : {}),
    webPreferences: {
      preload: resolvePreloadScriptPath(__dirname),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof devServerUrl === 'string' && devServerUrl.length > 0) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

async function listWindowSources(): Promise<CaptureSource[]> {
  const electronSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  });

  const rawSources: RawCaptureSource[] = electronSources.map((source) => {
    const rawSource: RawCaptureSource = {
      id: source.id,
      name: source.name,
      thumbnailDataUrl: source.thumbnail.toDataURL()
    };

    if (typeof source.display_id === 'string' && source.display_id.length > 0) {
      rawSource.displayId = source.display_id;
    }

    return rawSource;
  });

  return sourceCatalog.refresh(rawSources);
}

async function isSourceStillAvailable(sourceId: string): Promise<boolean> {
  const electronSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  return electronSources.some((source) => source.id === sourceId);
}

function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void (async () => {
      if (!request.videoRequested || request.audioRequested) {
        callback({});
        return;
      }

      const selectedSource = sourceCatalog.getSelected();
      if (selectedSource === null) {
        callback({});
        return;
      }

      const electronSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
      const matchingSource = electronSources.find((source) => source.id === selectedSource.id);
      if (matchingSource === undefined) {
        sourceCatalog.clearSelected();
        callback({});
        return;
      }

      callback({ video: matchingSource });
    })().catch((error: unknown) => {
      console.error('Display media request failed:', error);
      callback({});
    });
  });
}

async function installIpcHandlers(): Promise<void> {
  registerCaptureIpcHandlers({
    ipcMain,
    shell,
    sourceCatalog,
    recordingStore,
    getSettings: (): AppSettings => ({
      recordingsPath: recordingStore.directory,
      screenPermission: getScreenPermissionStatus(),
      platform: process.platform
    }),
    listWindowSources,
    isSourceStillAvailable
  });
  registerTimelineIpcHandlers(ipcMain, timelineIpcService);
  registerResultAssetImportHandlers(ipcMain, resultAssetImportService);
  registerUpdaterIpcHandlers(ipcMain, {
    controller: updaterController,
    currentVersion: app.getVersion(),
    listWindows: () => BrowserWindow.getAllWindows()
  });

  ipcMain.handle(IPC_CHANNELS.aiSelectReferenceImage, () =>
    selectReferenceImage(() => dialog.showOpenDialog({
      title: 'Choose a reference image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: [...REFERENCE_IMAGE_EXTENSIONS] }]
    }))
  );
  registerExportIpcHandlers(ipcMain, exportIpcService);
  registerChatGptOAuthIpcHandlers({
    service: chatGptOAuthService,
    registerHandler: (channel, handler) => ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
  });
  registerLlmPromptIpcHandler({
    router: llmPromptRouter,
    registerHandler: (channel, handler) => ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
  });

  ipcMain.handle(IPC_CHANNELS.aiGenerateVideo, async (_event, request) => {
    try {
      const job = await createVideoGenerationJob(request);
      return ok(job);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to create video job');
    }
  });

  ipcMain.handle(IPC_CHANNELS.aiGetVideoJob, async (_event, jobId: string) => {
    const job = getVideoGenerationJob(jobId);
    if (job === null) {
      return fail('JOB_NOT_FOUND', 'Video generation job was not found.');
    }
    return ok(job);
  });

  ipcMain.handle(IPC_CHANNELS.aiGenerateImage, async (_event, request) => {
    try {
      const job = await createImageGenerationJob(request);
      return ok(job);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to create image job');
    }
  });

  /*
    What generation has cost this month, and the ceiling on it.

    Reading is free; setting the ceiling is a person's decision, which is why
    it is here and not among the agent's tools — an agent that could raise its
    own limit does not have one.
  */
  ipcMain.handle(IPC_CHANNELS.generationSpendGet, async () => {
    const ledger = await generationSpendStore.read();
    return ok({
      total: await generationSpendStore.monthToDate(),
      ...(ledger.capUsd === undefined ? {} : { capUsd: ledger.capUsd })
    });
  });

  ipcMain.handle(IPC_CHANNELS.generationSpendSetCap, async (_event, capUsd: number | null) => {
    try {
      const ledger = await generationSpendStore.setCap(capUsd);
      return ok({
        total: await generationSpendStore.monthToDate(),
        ...(ledger.capUsd === undefined ? {} : { capUsd: ledger.capUsd })
      });
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to set the spending limit');
    }
  });

  ipcMain.handle(IPC_CHANNELS.aiGetImageJob, async (_event, jobId: string) => {
    const job = getImageGenerationJob(jobId);
    if (job === null) {
      return fail('JOB_NOT_FOUND', 'Image generation job was not found.');
    }
    return ok(job);
  });

  // Hands a generated still back in the same inline shape the file picker
  // produces, so image-to-video does not care where the seed came from.
  ipcMain.handle(IPC_CHANNELS.aiUseImageAsVideoReference, async (_event, jobId: string) => {
    const reference = getGeneratedImageAsReference(jobId);
    if (reference === null) {
      return fail('JOB_NOT_FOUND', 'No completed image is available for that job.');
    }
    return ok(reference);
  });

  // The only route a generated image has out of the app until the timeline
  // learns about stills: the user picks the destination, main writes the bytes.
  ipcMain.handle(IPC_CHANNELS.aiSaveImageResult, async (_event, jobId: string) => {
    const job = getImageGenerationJob(jobId);
    if (job === null || job.status !== 'completed' || job.outputFilePath === undefined) {
      return fail('JOB_NOT_FOUND', 'No completed image is available for that job.');
    }
    const suggested = `AI_Image_${job.id.slice(-6)}${extname(job.outputFilePath)}`;
    const choice = await dialog.showSaveDialog({ title: 'Save generated image', defaultPath: suggested });
    if (choice.canceled || choice.filePath === undefined || choice.filePath.length === 0) {
      return ok({ saved: false });
    }
    try {
      await copyFile(job.outputFilePath, choice.filePath);
      return ok({ saved: true });
    } catch (err) {
      return fail('FILE_WRITE_FAILED', err instanceof Error ? err.message : 'The image could not be saved.');
    }
  });

  ipcMain.handle(IPC_CHANNELS.aiGenerateSpeech, async (_event, request) => {
    try {
      const job = await createSpeechGenerationJob(request);
      return ok(job);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to create speech job');
    }
  });

  ipcMain.handle(IPC_CHANNELS.aiGetSpeechJob, async (_event, jobId: string) => {
    const job = getSpeechGenerationJob(jobId);
    if (job === null) {
      return fail('JOB_NOT_FOUND', 'Speech generation job was not found.');
    }
    return ok(job);
  });

  ipcMain.handle(IPC_CHANNELS.getProviderCredentials, async () => {
    try {
      const status = await credentialStore.getCredentialStatus();
      return ok(status);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to retrieve credential status');
    }
  });

  ipcMain.handle(IPC_CHANNELS.setProviderCredential, async (_event, provider: any, apiKey: string) => {
    try {
      await credentialStore.setCredential(provider, apiKey);
      return ok({ updated: true });
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to save credential');
    }
  });

  const mcpServerInstance = new OpenVideoMcpServer();
  mcpServerInstance.setServices(projectStore, exportIpcService);
  mcpServerInstance.setResultImportService(resultAssetImportService);
  mcpServerInstance.setSpendStore(generationSpendStore);
  // Agent tools write the project straight to disk; tell open editors to reload
  // so the change shows up on the timeline instead of being silently shadowed.
  mcpServerInstance.setProjectTimelineChangeNotifier((projectId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.projectTimelineChanged, { projectId });
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpGetTools, async () => {
    try {
      const definition = getOpenVideoMcpDefinition();
      return ok(definition);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to inspect MCP tools');
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpExecuteTool, async (_event, toolName: string, params: unknown) => {
    try {
      if (toolName === 'createVideoJob') {
        const result = await mcpServerInstance.createVideoJob(params as any);
        return ok(result);
      }
      if (toolName === 'createSpeechJob') {
        const result = await mcpServerInstance.createSpeechJob(params as any);
        return ok(result);
      }
      if (toolName === 'getJobStatus') {
        const result = await mcpServerInstance.getJobStatus(params as any);
        return ok(result);
      }
      if (toolName === 'addClipToTimeline') {
        const result = await mcpServerInstance.addClipToTimeline(params as any);
        return ok(result);
      }
      if (toolName === 'exportProjectVideo') {
        const result = await mcpServerInstance.exportProjectVideo(params as any);
        return ok(result);
      }
      return fail('INVALID_INPUT', `MCP tool ${toolName} is not recognized.`);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : `Failed to execute MCP tool ${toolName}`);
    }
  });

  const agentChatTools = await createAgentChatTools(mcpServerInstance);
  const agentChatGraphBundle = buildAgentChatGraph({
    tools: agentChatTools,
    // Derived from the tools that exist, so a tool added tomorrow asks for
    // approval by default rather than because someone remembered a list.
    mutatingToolNames: agentChatMutatingToolNames(agentChatTools),
    spendToolNames: AGENT_CHAT_SPEND_TOOL_NAMES,
    createModel: createAgentChatModel(agentChatTools, credentialStore, chatGptOAuthService)
  });
  const agentChatSessions = new AgentChatSessionManager(agentChatGraphBundle);
  registerAgentChatIpcHandlers(ipcMain, agentChatSessions, new AgentChatHistoryStore(projectStore));
}

app.setName(APP_NAME);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  copyright: 'Open source under the MIT License'
});

app.whenReady().then(async () => {
  installApplicationMenu(() => {
    // The user asked, so an up-to-date or failed answer is reported here where
    // the startup path stays quiet about both.
    void promptForUpdate(updaterController, { reportNothingToDo: true, ...updaterPromptIo }).catch((error: unknown) => {
      console.error('Update check failed:', error);
    });
  });
  installDisplayMediaHandler();
  registerTimelineAssetProtocol(timelineIpcService);
  await installIpcHandlers();
  createWindow();

  // Checked after the window exists so the first result has somewhere to land,
  // and left unawaited so a slow or unreachable GitHub never delays startup.
  // Silent unless there is an update to act on: a launch that announces "up to
  // date" trains the user to dismiss the box that also carries the real one.
  void updaterController
    .start()
    // start() already checked; prompting from its result avoids a second
    // network round trip on every launch.
    .then((state) => promptForUpdateState(updaterController, state, { reportNothingToDo: false, ...updaterPromptIo }))
    .catch((error: unknown) => {
      console.error('Update check failed:', error);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('Electron startup failed:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  exportIpcService.cancelAll();
});
