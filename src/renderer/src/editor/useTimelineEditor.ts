import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  addTrack,
  deleteClip,
  moveClip,
  splitClip,
  trimClipLeft,
  trimClipRight,
  updateClipEffects
} from '../../../shared/timelineLogic';
import type { ClipEffects, LocalProjectSnapshot, LocalProjectSummary, MediaAsset, MediaKind, TimelineDocument } from '../../../shared/timelineTypes';
import { errorMessage, type StatusMessage } from '../appTypes';
import { createTimelineHistory, pushTimelineHistory, redoTimelineHistory, undoTimelineHistory, type TimelineHistory } from './editorTimelineHistory';
import { clampPlayheadMs, findClipSelection, findFirstCompatibleTrack, insertionStartForTrack, nextTrackName, placeReadyAssetOnTimeline } from './editorTimelineView';
import { metadataProbeFailureMessage } from './mediaLoadFailures';
import { useProjectAssetImports } from './useProjectAssetImports';
import { useTimelinePlayback } from './useTimelinePlayback';

type TimelineUpdate = (timeline: TimelineDocument) => TimelineDocument | null;

function createOpaqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useTimelineEditor() {
  const [projects, setProjects] = useState<readonly LocalProjectSummary[]>([]);
  const [project, setProject] = useState<LocalProjectSnapshot | null>(null);
  const [newProjectName, setNewProjectName] = useState('Untitled cutdown');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedClipId, setSelectedClipId] = useState('');
  const [timelineHistory, setTimelineHistory] = useState<TimelineHistory | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hasUnsavedTimeline, setHasUnsavedTimeline] = useState(false);
  const [metadataProbeFailuresByAssetId, setMetadataProbeFailuresByAssetId] = useState<Readonly<Record<string, string>>>({});
  const [metadataProbeRetryRevisionsByAssetId, setMetadataProbeRetryRevisionsByAssetId] = useState<Readonly<Record<string, number>>>({});
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({ tone: 'neutral', text: 'Create or open a project to start editing locally.' });

  const selectedAsset = useMemo(
    () => project?.assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [project, selectedAssetId]
  );
  const selectedClip = useMemo(
    () => project === null || selectedClipId.length === 0 ? null : findClipSelection(project.timeline, project.assets, selectedClipId),
    [project, selectedClipId]
  );
  const playback = useTimelinePlayback(project);

  const setLoadedProject = useCallback((snapshot: LocalProjectSnapshot | null) => {
    setProject(snapshot);
    setTimelineHistory(snapshot === null ? null : createTimelineHistory(snapshot.timeline));
    playback.resetPlayback();
  }, [playback]);

  const refreshProjects = useCallback(async () => {
    const response = await window.videoTool.listProjects();
    if (response.ok) {
      setProjects(response.value);
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    setMetadataProbeFailuresByAssetId({});
    setMetadataProbeRetryRevisionsByAssetId({});
  }, [project?.id]);

  const clearMetadataProbeFailure = useCallback((assetId: string) => {
    setMetadataProbeFailuresByAssetId((current) => {
      if (current[assetId] === undefined) return current;
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }, []);

  const reportMetadataProbeFailure = useCallback((assetId: string) => {
    setMetadataProbeFailuresByAssetId((current) => ({ ...current, [assetId]: metadataProbeFailureMessage() }));
  }, []);

  const retryAssetMetadataProbe = useCallback((assetId: string) => {
    clearMetadataProbeFailure(assetId);
    setMetadataProbeRetryRevisionsByAssetId((current) => ({ ...current, [assetId]: (current[assetId] ?? 0) + 1 }));
  }, [clearMetadataProbeFailure]);

  const openProject = useCallback(async (projectId: string): Promise<boolean> => {
    setIsBusy(true);
    const response = await window.videoTool.openProject({ projectId });
    setIsBusy(false);
    if (response.ok) {
      setLoadedProject(response.value);
      setSelectedAssetId(response.value.assets[0]?.id ?? '');
      setSelectedClipId('');
      setHasUnsavedTimeline(false);
      setStatusMessage({ tone: 'success', text: `Opened ${response.value.name}.` });
      return true;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
    return false;
  }, []);

  const createProject = useCallback(async (): Promise<boolean> => {
    setIsBusy(true);
    const response = await window.videoTool.createProject({ name: newProjectName });
    setIsBusy(false);
    if (response.ok) {
      setLoadedProject(response.value);
      setSelectedAssetId('');
      setSelectedClipId('');
      setHasUnsavedTimeline(false);
      await refreshProjects();
      setStatusMessage({ tone: 'success', text: `Created ${response.value.name}.` });
      return true;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
    return false;
  }, [newProjectName, refreshProjects]);

  const deleteCurrentProject = useCallback(async () => {
    if (project === null) return;
    setIsBusy(true);
    const response = await window.videoTool.deleteProject({ projectId: project.id });
    setIsBusy(false);
    if (response.ok) {
      setLoadedProject(null);
      setSelectedAssetId('');
      setSelectedClipId('');
      setHasUnsavedTimeline(false);
      await refreshProjects();
      setStatusMessage({ tone: 'warning', text: 'Project deleted locally.' });
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [project, refreshProjects, setLoadedProject]);

  const { importAssets, importRecordingResult, importTtsResult, importAiResult } = useProjectAssetImports({ project, setIsBusy, setProject, setSelectedAssetId, setStatusMessage });

  const replaceTimeline = useCallback((update: TimelineUpdate, successText: string): TimelineDocument | null => {
    if (project === null) return null;
    const timeline = update(project.timeline);
    if (timeline === null) {
      setStatusMessage({ tone: 'warning', text: 'Timeline edit was rejected because it would break track or clip rules.' });
      return null;
    }
    setProject({ ...project, timeline });
    setTimelineHistory((current) => current === null ? createTimelineHistory(timeline) : pushTimelineHistory(current, timeline));
    playback.clampToTimeline(timeline);
    setHasUnsavedTimeline(true);
    setStatusMessage({ tone: 'neutral', text: successText });
    return timeline;
  }, [playback, project]);

  const placeSelectedAsset = useCallback(() => {
    if (project === null || selectedAsset === null || selectedAsset.metadata === null) return;
    const track = findFirstCompatibleTrack(project.timeline, selectedAsset.kind);
    if (track === null) return;
    const placement = placeReadyAssetOnTimeline(project.timeline, selectedAsset, track.id, createOpaqueId('clip'), insertionStartForTrack(track));
    if (placement === null) return;
    const timeline = replaceTimeline(() => placement.timeline, `Placed ${selectedAsset.displayName} on ${track.name}.`);
    if (timeline === null) return;
    playback.setPlayheadMs(placement.playheadMs, timeline);
    setSelectedClipId(placement.clip.id);
  }, [playback, project, replaceTimeline, selectedAsset]);

  const placeAssetOnTrack = useCallback((assetId: string, trackId: string, timelineStartMs: number) => {
    if (project === null) return;
    const asset = project.assets.find((candidate) => candidate.id === assetId) ?? null;
    if (asset === null) return;
    const placement = placeReadyAssetOnTimeline(project.timeline, asset, trackId, createOpaqueId('clip'), timelineStartMs);
    if (placement === null) return;
    const timeline = replaceTimeline(() => placement.timeline, `Placed ${asset.displayName} on the timeline.`);
    if (timeline === null) return;
    playback.setPlayheadMs(placement.playheadMs, timeline);
    setSelectedAssetId(asset.id);
    setSelectedClipId(placement.clip.id);
  }, [playback, project, replaceTimeline]);

  const addTimelineTrack = useCallback((kind: MediaKind) => {
    replaceTimeline((timeline) => addTrack(timeline, { id: createOpaqueId(`${kind}-track`), kind, name: nextTrackName(timeline, kind) }), `Added a ${kind} track.`);
  }, [replaceTimeline]);

  const deleteSelectedClip = useCallback(() => {
    if (selectedClip === null) return;
    replaceTimeline((timeline) => deleteClip(timeline, selectedClip.clip.id), 'Deleted selected clip.');
    setSelectedClipId('');
  }, [replaceTimeline, selectedClip]);

  const moveSelectedClip = useCallback((deltaMs: number) => {
    if (selectedClip === null) return;
    const startMs = Math.max(0, selectedClip.clip.timelineStartMs + deltaMs);
    replaceTimeline((timeline) => moveClip(timeline, { clipId: selectedClip.clip.id, targetTrackId: selectedClip.track.id, timelineStartMs: startMs }), 'Moved selected clip.');
  }, [replaceTimeline, selectedClip]);

  const moveClipToTrack = useCallback((clipId: string, trackId: string, timelineStartMs: number) => {
    replaceTimeline((timeline) => moveClip(timeline, { clipId, targetTrackId: trackId, timelineStartMs: Math.max(0, timelineStartMs) }), 'Moved selected clip.');
    setSelectedClipId(clipId);
  }, [replaceTimeline]);

  const trimSelectedClip = useCallback((edge: 'left' | 'right', deltaMs: number) => {
    if (selectedClip === null) return;
    replaceTimeline((timeline) => edge === 'left'
      ? trimClipLeft(timeline, { clipId: selectedClip.clip.id, timelineStartMs: selectedClip.clip.timelineStartMs + deltaMs })
      : trimClipRight(timeline, { clipId: selectedClip.clip.id, timelineEndMs: selectedClip.clip.timelineStartMs + selectedClip.clip.sourceEndMs - selectedClip.clip.sourceStartMs + deltaMs }), 'Trimmed selected clip.');
  }, [replaceTimeline, selectedClip]);

  const trimClipTo = useCallback((clipId: string, edge: 'left' | 'right', timelineMs: number) => {
    replaceTimeline((timeline) => edge === 'left'
      ? trimClipLeft(timeline, { clipId, timelineStartMs: timelineMs })
      : trimClipRight(timeline, { clipId, timelineEndMs: timelineMs }), 'Trimmed selected clip.');
    setSelectedClipId(clipId);
  }, [replaceTimeline]);

  const splitSelectedClip = useCallback(() => {
    if (selectedClip === null) return;
    const midpointMs = selectedClip.clip.timelineStartMs + Math.round((selectedClip.clip.sourceEndMs - selectedClip.clip.sourceStartMs) / 2);
    replaceTimeline((timeline) => splitClip(timeline, { clipId: selectedClip.clip.id, atMs: midpointMs, rightClipId: createOpaqueId('clip') }), 'Split selected clip at its midpoint.');
  }, [replaceTimeline, selectedClip]);

  const splitAtPlayhead = useCallback(() => {
    if (selectedClip === null) return;
    replaceTimeline((timeline) => splitClip(timeline, { clipId: selectedClip.clip.id, atMs: playback.playheadMs, rightClipId: createOpaqueId('clip') }), 'Split selected clip at the playhead.');
  }, [playback.playheadMs, replaceTimeline, selectedClip]);

  const updateSelectedClipEffects = useCallback((effects: Partial<ClipEffects>) => {
    if (selectedClip === null) return;
    replaceTimeline((timeline) => updateClipEffects(timeline, { clipId: selectedClip.clip.id, effects }), 'Updated selected clip effects.');
  }, [replaceTimeline, selectedClip]);

  const undoTimeline = useCallback(() => {
    if (timelineHistory === null) return;
    const next = undoTimelineHistory(timelineHistory);
    if (next === null) return;
    setTimelineHistory(next);
    setProject((current) => current === null ? current : { ...current, timeline: next.present });
    playback.clampToTimeline(next.present);
    setHasUnsavedTimeline(true);
    setStatusMessage({ tone: 'neutral', text: 'Undid timeline edit.' });
  }, [playback, timelineHistory]);

  const redoTimeline = useCallback(() => {
    if (timelineHistory === null) return;
    const next = redoTimelineHistory(timelineHistory);
    if (next === null) return;
    setTimelineHistory(next);
    setProject((current) => current === null ? current : { ...current, timeline: next.present });
    playback.clampToTimeline(next.present);
    setHasUnsavedTimeline(true);
    setStatusMessage({ tone: 'neutral', text: 'Redid timeline edit.' });
  }, [playback, timelineHistory]);

  const updateAssetMetadata = useCallback(async (assetId: string, metadata: { readonly durationMs: number; readonly width?: number; readonly height?: number }): Promise<boolean> => {
    if (project === null) return false;
    const response = await window.videoTool.updateAssetMetadata({ projectId: project.id, assetId, ...metadata });
    if (response.ok) {
      setProject((current) => current === null ? current : { ...current, assets: current.assets.map((asset) => asset.id === response.value.id ? response.value : asset) });
      clearMetadataProbeFailure(assetId);
      return true;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
    return false;
  }, [clearMetadataProbeFailure, project]);

  const saveTimeline = useCallback(async () => {
    if (project === null) return;
    setIsBusy(true);
    const response = await window.videoTool.saveTimeline({ projectId: project.id, timeline: project.timeline });
    setIsBusy(false);
    if (response.ok) {
      setLoadedProject(response.value);
      setHasUnsavedTimeline(false);
      setStatusMessage({ tone: 'success', text: 'Timeline saved locally.' });
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [project, setLoadedProject]);

  return {
    addTimelineTrack, createProject, deleteCurrentProject, deleteSelectedClip, hasUnsavedTimeline, importAssets,
    importRecordingResult, importTtsResult, importAiResult, isBusy, metadataProbeFailuresByAssetId, metadataProbeRetryRevisionsByAssetId, moveSelectedClip, newProjectName,
    openProject, placeSelectedAsset, project, projects, refreshProjects, reportMetadataProbeFailure, retryAssetMetadataProbe, saveTimeline,
    selectedAsset, selectedAssetId, selectedClip, selectedClipId, setNewProjectName, setSelectedAssetId, setSelectedClipId,
    splitSelectedClip, statusMessage, trimSelectedClip, updateAssetMetadata, updateSelectedClipEffects,
    activePlaybackClip: playback.activePlaybackClip, canRedoTimeline: (timelineHistory?.future.length ?? 0) > 0,
    canUndoTimeline: (timelineHistory?.past.length ?? 0) > 0, isPlaying: playback.isPlaying, moveClipToTrack,
    placeAssetOnTrack, playheadMs: playback.playheadMs, redoTimeline, setIsPlaying: playback.setIsPlaying,
    setPlayheadMs: playback.setPlayheadMs, splitAtPlayhead, trimClipTo, undoTimeline
  };
}

export type TimelineEditorController = ReturnType<typeof useTimelineEditor>;
