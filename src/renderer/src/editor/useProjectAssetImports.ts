import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { mergeImportedAssets } from '../../../shared/projectAssetMerge';
import type { LocalProjectSnapshot, MediaKind } from '../../../shared/timelineTypes';
import { errorMessage, type StatusMessage } from '../appTypes';
import { projectAssetImportFailureMessage } from './projectAssetImportFeedback';

type ProjectAssetImportState = {
  readonly project: LocalProjectSnapshot | null;
  readonly setIsBusy: Dispatch<SetStateAction<boolean>>;
  readonly setProject: Dispatch<SetStateAction<LocalProjectSnapshot | null>>;
  readonly setSelectedAssetId: Dispatch<SetStateAction<string>>;
  readonly setStatusMessage: Dispatch<SetStateAction<StatusMessage>>;
};

type PendingImportPresentation = {
  readonly projectId: string;
  readonly selectedAssetId: string | null;
  readonly statusMessage: StatusMessage;
};

export function useProjectAssetImports({ project, setIsBusy, setProject, setSelectedAssetId, setStatusMessage }: ProjectAssetImportState) {
  const [presentationVersion, setPresentationVersion] = useState(0);
  const pendingPresentationRef = useRef<PendingImportPresentation | null>(null);

  useEffect(() => {
    const pendingPresentation = pendingPresentationRef.current;
    if (pendingPresentation === null) return;
    pendingPresentationRef.current = null;
    if (project?.id !== pendingPresentation.projectId) return;
    if (pendingPresentation.selectedAssetId !== null) setSelectedAssetId(pendingPresentation.selectedAssetId);
    setStatusMessage(pendingPresentation.statusMessage);
  }, [presentationVersion, project?.id, setSelectedAssetId, setStatusMessage]);

  const presentProjectImport = useCallback((presentation: PendingImportPresentation) => {
    pendingPresentationRef.current = presentation;
    setPresentationVersion((current) => current + 1);
  }, []);

  const mergeAssetsIntoProject = useCallback((projectId: string, importedAssets: LocalProjectSnapshot['assets']) => {
    setProject((current) => current === null || current.id !== projectId ? current : { ...current, assets: mergeImportedAssets(current.assets, importedAssets) });
  }, [setProject]);

  const importAssets = useCallback(async (acceptedKinds?: readonly MediaKind[]) => {
    if (project === null) return;
    const projectId = project.id;
    setIsBusy(true);
    const input = acceptedKinds === undefined ? { projectId } : { projectId, acceptedKinds };
    let response: Awaited<ReturnType<typeof window.videoTool.importProjectAssets>>;
    try {
      response = await window.videoTool.importProjectAssets(input);
    } catch (error: unknown) {
      presentProjectImport({ projectId, selectedAssetId: null, statusMessage: { tone: 'danger', text: projectAssetImportFailureMessage(error) } });
      return;
    } finally {
      setIsBusy(false);
    }
    if (response.ok) {
      const importedAssetId = response.value.assets[0]?.id ?? null;
      mergeAssetsIntoProject(projectId, response.value.assets);
      presentProjectImport({ projectId, selectedAssetId: importedAssetId, statusMessage: { tone: 'success', text: response.value.assets.length === 0 ? 'Import canceled.' : `Imported ${response.value.assets.length} asset(s).` } });
      return;
    }
    presentProjectImport({ projectId, selectedAssetId: null, statusMessage: { tone: 'danger', text: errorMessage(response.error) } });
  }, [mergeAssetsIntoProject, presentProjectImport, project, setIsBusy]);

  const importRecordingResult = useCallback(async (sessionId: string): Promise<StatusMessage> => {
    if (project === null) return { tone: 'warning', text: 'Open a local project before importing the recording.' };
    const projectId = project.id;
    setIsBusy(true);
    let response: Awaited<ReturnType<typeof window.videoTool.importRecordingResultAsset>>;
    try {
      response = await window.videoTool.importRecordingResultAsset({ projectId, sessionId });
    } catch (error: unknown) {
      const message: StatusMessage = { tone: 'danger', text: error instanceof Error ? error.message : 'Recording import failed.' };
      presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
      return message;
    } finally {
      setIsBusy(false);
    }
    if (response.ok) {
      const importedAssetId = response.value.assets[0]?.id ?? null;
      mergeAssetsIntoProject(projectId, response.value.assets);
      const message: StatusMessage = { tone: 'success', text: `Imported recording into ${project.name}.` };
      presentProjectImport({ projectId, selectedAssetId: importedAssetId, statusMessage: message });
      return message;
    }
    const message: StatusMessage = { tone: 'danger', text: errorMessage(response.error) };
    presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
    return message;
  }, [mergeAssetsIntoProject, presentProjectImport, project, setIsBusy]);

  const importTtsResult = useCallback(async (jobId: string): Promise<StatusMessage> => {
    if (project === null) return { tone: 'warning', text: 'Open a local project before importing the narration audio.' };
    const projectId = project.id;
    setIsBusy(true);
    let response: Awaited<ReturnType<typeof window.videoTool.importTtsResultAsset>>;
    try {
      response = await window.videoTool.importTtsResultAsset({ projectId, jobId });
    } catch (error: unknown) {
      const message: StatusMessage = { tone: 'danger', text: error instanceof Error ? error.message : 'Narration import failed.' };
      presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
      return message;
    } finally {
      setIsBusy(false);
    }
    if (response.ok) {
      const importedAssetId = response.value.assets[0]?.id ?? null;
      mergeAssetsIntoProject(projectId, response.value.assets);
      const message: StatusMessage = { tone: 'success', text: `Imported narration into ${project.name}.` };
      presentProjectImport({ projectId, selectedAssetId: importedAssetId, statusMessage: message });
      return message;
    }
    const message: StatusMessage = { tone: 'danger', text: errorMessage(response.error) };
    presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
    return message;
  }, [mergeAssetsIntoProject, presentProjectImport, project, setIsBusy]);

  const importAiResult = useCallback(async (jobId: string): Promise<StatusMessage> => {
    if (project === null) return { tone: 'warning', text: 'Open a local project before importing the AI media asset.' };
    const projectId = project.id;
    setIsBusy(true);
    let response: Awaited<ReturnType<typeof window.videoTool.importAiResultAsset>>;
    try {
      response = await window.videoTool.importAiResultAsset({ projectId, jobId });
    } catch (error: unknown) {
      const message: StatusMessage = { tone: 'danger', text: error instanceof Error ? error.message : 'AI media import failed.' };
      presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
      return message;
    } finally {
      setIsBusy(false);
    }
    if (response.ok) {
      const importedAssetId = response.value.assets[0]?.id ?? null;
      mergeAssetsIntoProject(projectId, response.value.assets);
      const message: StatusMessage = { tone: 'success', text: `Imported AI media asset into ${project.name}.` };
      presentProjectImport({ projectId, selectedAssetId: importedAssetId, statusMessage: message });
      return message;
    }
    const message: StatusMessage = { tone: 'danger', text: errorMessage(response.error) };
    presentProjectImport({ projectId, selectedAssetId: null, statusMessage: message });
    return message;
  }, [mergeAssetsIntoProject, presentProjectImport, project, setIsBusy]);

  return { importAssets, importRecordingResult, importTtsResult, importAiResult };
}
