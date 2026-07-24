import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } from 'electron';
import { join } from 'node:path';

import { AssetLibraryStore } from './assetLibraryStore';
import type { AppSettings, CaptureSource } from '../shared/models';
import type { MediaKind } from '../shared/timelineTypes';
import { SourceCatalog, type RawCaptureSource } from '../shared/sourceCatalog';
import { registerCaptureIpcHandlers } from './captureIpcHandlers';
import { ExportIpcService } from './exportIpcService';
import { registerExportIpcHandlers } from './exportIpcHandlers';
import { ExportJobStore } from './exportJobStore';
import { LocalTtsJobStore } from './localTtsJobStore';
import { ProjectStore } from './projectStore';
import { RecordingFileStore } from './recordingStore';
import { registerResultAssetImportHandlers } from './resultAssetImportHandlers';
import { ResultAssetImportService } from './resultAssetImportService';
import { registerTimelineAssetProtocol, registerTimelineAssetScheme } from './timelineAssetProtocol';
import { registerTimelineIpcHandlers } from './timelineIpcHandlers';
import { TimelineIpcService } from './timelineIpcService';
import { registerVoiceTtsIpcHandlers } from './voiceTtsIpcHandlers';
import { VoiceProfileStore } from './voiceProfileStore';
import { VoiceTtsIpcService } from './voiceTtsIpcService';
import { resolvePreloadScriptPath } from './preloadPath';
import { fail, ok } from './ipcResponses';
import { IPC_CHANNELS } from '../shared/ipc';
import { installApplicationMenu } from './applicationMenu';

import { createSpeechGenerationJob, createVideoGenerationJob, getCompletedAiSource, getSpeechGenerationJob, getVideoGenerationJob } from './aiJobManager';

registerTimelineAssetScheme();

const sourceCatalog = new SourceCatalog();
const recordingStore = new RecordingFileStore(resolveRecordingsDirectory());
const projectStore = new ProjectStore(join(app.getPath('userData'), 'projects'));
const assetLibraryStore = new AssetLibraryStore(join(app.getPath('userData'), 'projects'), projectStore);
const voiceProfileStore = new VoiceProfileStore(join(app.getPath('userData'), 'voice-profiles'));
const ttsJobStore = new LocalTtsJobStore();
const exportJobStore = new ExportJobStore();
const timelineIpcService = new TimelineIpcService({
  projects: projectStore,
  assets: assetLibraryStore,
  selectMediaFiles: ({ acceptedKinds, extensions }) => dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: dialogFilters(acceptedKinds, extensions)
  })
});
const voiceTtsService = new VoiceTtsIpcService({
  voiceProfiles: voiceProfileStore,
  ttsJobs: ttsJobStore,
  audioRoot: join(app.getPath('userData'), 'tts-audio'),
  openPath: (path) => shell.openPath(path),
  revealPath: (path) => shell.showItemInFolder(path)
});
const resultAssetImportService = new ResultAssetImportService({
  assets: assetLibraryStore,
  resolveRecordingSource: (sessionId) => {
    const result = recordingStore.getResult(sessionId);
    return result === null
      ? null
      : { sourcePath: result.outputPath, displayName: result.fileName, kind: 'video', mimeType: 'video/webm' };
  },
  resolveTtsSource: (jobId) => voiceTtsService.getCompletedAudioSource(jobId) ?? getCompletedAiSource(jobId)
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'OpenVideo',
    backgroundColor: '#10100f',
    show: false,
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

function installIpcHandlers(): void {
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
  registerVoiceTtsIpcHandlers(ipcMain, voiceTtsService);
  registerTimelineIpcHandlers(ipcMain, timelineIpcService);
  registerResultAssetImportHandlers(ipcMain, resultAssetImportService);
  registerExportIpcHandlers(ipcMain, exportIpcService);

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
}

app.whenReady().then(() => {
  installApplicationMenu();
  installDisplayMediaHandler();
  registerTimelineAssetProtocol(timelineIpcService);
  installIpcHandlers();
  createWindow();

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
