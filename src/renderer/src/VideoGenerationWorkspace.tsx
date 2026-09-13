import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  CONTINUITY_REVIEW_FIELDS,
  type AiProjectDocument,
  type ContinuityReviewField,
  type ContinuityReviewValue
} from '../../shared/aiProjectDomain';
import {
  addGenerationCandidate,
  chainContinuationFrame,
  decideGenerationCandidate,
  emptyContinuityReview,
  nextApprovedWriterShotId,
  setCandidateContinuity,
  setCandidateReviewNotes,
  updateGenerationCandidate,
  type GenerationReviewResult
} from '../../shared/generationReview';
import { approvedWriterShots } from '../../shared/writerPipeline';
import { compileVideoContinuityPrompt, stripVideoContinuityLocks, videoContinuityAvailability } from '../../shared/videoContinuity';
import {
  DEFAULT_VIDEO_CONTINUITY_CONTROLS,
  VIDEO_CONTINUITY_CONTROL_KEYS,
  parseVideoContinuityPreferences,
  videoContinuityPreferencesStorageKey,
  type VideoContinuityControlKey,
  type VideoContinuityControls
} from '../../shared/videoContinuitySettings';

import { originalOf, refineShotPrompt, revisionsOf } from '../../shared/shotPrompt';
import type { ImageAspectRatio, ProviderExecutionMode, ReferenceImageSelection, VideoGenerationJob } from '../../shared/providerSeams';
import { reconcileVideoCandidateAfterRestart } from '../../shared/videoJobRecovery';
import { estimateVideoPlanCost } from '../../shared/mediaGenerationPricing';
import {
  DEFAULT_GOOGLE_FLOW_PREFERENCES,
  GOOGLE_FLOW_PREFERENCES_STORAGE_KEY,
  googleFlowVideoDurationOptions,
  googleFlowVideoModelFor,
  parseGoogleFlowPreferences,
  type BrowserSessionStatus
} from '../../shared/browserSession';
import type { MediaAsset } from '../../shared/timelineTypes';
import type { ComfyUiMotionWorkerStatus, MotionControlMode } from '../../shared/comfyUiMotion';
import { DomainModelPicker } from './DomainModelPicker';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { getVideoModelCapabilities, getVideoOperationConstraints, isVideoOperationImplemented, type VideoOperation } from '../../shared/mediaCapabilityRegistry';
import { Button, StatusCard } from './ui';
import { ProductionBoard } from './ProductionBoard';
import {
  batchableProductionVideoShotIds,
  planProductionVideoReferences,
  productionShotRows,
  PRODUCTION_BATCH_LIMIT,
  type ProductionImageTarget
} from '../../shared/productionWorkflow';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const VIDEO_JOB_UI_TIMEOUT_MS = 12 * 60_000;
const MOTION_JOB_UI_TIMEOUT_MS = 35 * 60_000;
const INPUT_MODES: readonly { readonly id: VideoOperation; readonly label: string }[] = [
  { id: 'text_to_video', label: 'Text' },
  { id: 'image_to_video', label: 'First frame' },
  { id: 'start_end', label: 'Start-End' },
  { id: 'reference_to_video', label: 'References' },
  { id: 'motion_control', label: 'Motion' }
];
const CONTINUITY_LABELS: Readonly<Record<ContinuityReviewField, string>> = {
  identity: 'Character identity',
  wardrobeProps: 'Wardrobe & props',
  settingPalette: 'Setting & palette',
  motionDirection: 'Motion direction',
  boundaryMatch: 'Start / end boundary'
};
const REVIEW_VALUES: readonly Exclude<ContinuityReviewValue, 'unchecked'>[] = ['pass', 'warning', 'fail'];
const CONTINUITY_CONTROL_DETAILS: Readonly<Record<VideoContinuityControlKey, {
  readonly label: string;
  readonly description: string;
}>> = {
  characterConsistency: {
    label: 'Character consistency',
    description: 'Pin Character Bible identity traits and auto-load approved character references when opening a shot.'
  },
  styleConsistency: {
    label: 'Visual style lock',
    description: 'Keep the approved palette, lighting, camera grammar, texture and forbidden changes.'
  },
  sceneConsistency: {
    label: 'Scene continuity',
    description: 'Keep the same setting, time of day, object layout and scene continuity notes.'
  },
  motionContinuity: {
    label: 'Motion continuity',
    description: 'Carry action, camera axis and screen direction forward from the previous Writer shot.'
  }
};

type VideoInputSnapshot = {
  readonly operation: VideoOperation;
  readonly referenceImage?: ReferenceImageSelection;
  readonly lastFrame?: ReferenceImageSelection;
  readonly referenceImages?: readonly ReferenceImageSelection[];
  readonly projectId?: string;
  readonly drivingVideoAssetId?: string;
  readonly motionMode?: MotionControlMode;
};
type VideoGenerationWorkspaceProps = {
  readonly writerDocument?: AiProjectDocument | null;
  readonly projectId?: string | null;
  readonly projectAssets?: readonly MediaAsset[];
  readonly onSaveAi?: (document: AiProjectDocument) => Promise<boolean>;
  /**
   * Controlled from App so the image studio's "Use for video" can hand a
   * generated still straight into this form. Keeping it local meant the handoff
   * could only ever be a suggestion to go and re-pick the file.
   */
  readonly referenceImage: ReferenceImageSelection | null;
  readonly onReferenceImageChange: (reference: ReferenceImageSelection | null) => void;
  /** Opens an editable Writer-derived image brief without submitting it. */
  readonly onGenerateProductionImage: (target: ProductionImageTarget, aspectRatio?: ImageAspectRatio) => string | null;
  /** Starts one or more Writer-derived stills without leaving Video Generation. */
  readonly onGenerateProductionImages: (targets: readonly ProductionImageTarget[], aspectRatio?: ImageAspectRatio) => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onOpenImageResults: () => void;
  /** Local project folder/name mirrored to the signed-in Flow workspace. */
  readonly projectName?: string | undefined;
};

function showGoogleFlowWindow(): boolean {
  try {
    return parseGoogleFlowPreferences(
      window.localStorage.getItem(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY)
    ).showWindowDuringGeneration;
  } catch {
    return DEFAULT_GOOGLE_FLOW_PREFERENCES.showWindowDuringGeneration;
  }
}

export function VideoGenerationWorkspace({
  writerDocument,
  onSaveAi,
  projectId,
  projectAssets = [],
  referenceImage,
  onReferenceImageChange,
  onGenerateProductionImage,
  onGenerateProductionImages,
  onOpenImageResults,
  projectName
}: VideoGenerationWorkspaceProps): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const videoModel = selectedModel('video-generation');
  const flowVideoModel = googleFlowVideoModelFor(videoModel.id);
  const grokImagineBrowser = videoModel.id === 'grok-imagine-video-1.5';
  const browserSessionSupported = flowVideoModel !== null || grokImagineBrowser;
  const [generationMode, setGenerationMode] = useState<ProviderExecutionMode>(
    browserSessionSupported ? 'browser_session' : videoModel.executionPath
  );
  const [flowSession, setFlowSession] = useState<BrowserSessionStatus | null>(null);
  const { importAiResult, placeAiAssetOnTimeline, assembleApprovedWriterShots } = useProjectResultImport();
  const [prompt, setPrompt] = useState('');
  const [writerShotId, setWriterShotId] = useState('');
  const [loadedWriterShotId, setLoadedWriterShotId] = useState('');
  const writerShots = approvedWriterShots(writerDocument);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [selectedOperation, setSelectedOperation] = useState<VideoOperation>('text_to_video');
  const [lastFrame, setLastFrame] = useState<ReferenceImageSelection | null>(null);
  const [referenceImages, setReferenceImages] = useState<readonly ReferenceImageSelection[]>([]);
  const [motionMode, setMotionMode] = useState<MotionControlMode>('move');
  const [drivingVideoAssetId, setDrivingVideoAssetId] = useState('');
  const [motionWorker, setMotionWorker] = useState<ComfyUiMotionWorkerStatus | null>(null);
  const [checkingMotionWorker, setCheckingMotionWorker] = useState(false);
  const drivingVideoAssets = projectAssets.filter((asset) => asset.kind === 'video');
  const drivingVideo = drivingVideoAssets.find((asset) => asset.id === drivingVideoAssetId);
  const motionAspectRatio: '16:9' | '9:16' | '1:1' = drivingVideo?.metadata?.width && drivingVideo.metadata.height
    ? drivingVideo.metadata.width / drivingVideo.metadata.height > 1.2 ? '16:9'
      : drivingVideo.metadata.height / drivingVideo.metadata.width > 1.2 ? '9:16' : '1:1'
    : '16:9';
  const previousReferenceImage = useRef<ReferenceImageSelection | null>(null);
  const operationAvailable = isVideoOperationImplemented(videoModel.id, selectedOperation);
  const operationConstraints = getVideoOperationConstraints(videoModel.id, selectedOperation)
    ?? getVideoOperationConstraints(videoModel.id, 'text_to_video');
  const durationOptions = generationMode === 'browser_session' && flowVideoModel !== null
    ? googleFlowVideoDurationOptions(flowVideoModel)
    : generationMode === 'browser_session' && grokImagineBrowser
      ? [6, 10, 15]
    : operationConstraints?.durationSeconds ?? [4, 8];
  const aspectRatioOptions = generationMode === 'browser_session' && flowVideoModel !== null
    ? ['16:9', '9:16'] as const
    : generationMode === 'browser_session' && grokImagineBrowser
      ? ['16:9', '9:16', '1:1'] as const
    : operationConstraints?.aspectRatios ?? ['16:9', '9:16'];
  // Switching engines keeps the chosen length when valid, else the closest option.
  const effectiveDuration = durationOptions.includes(durationSeconds)
    ? durationSeconds
    : durationOptions.reduce((best, candidate) =>
        Math.abs(candidate - durationSeconds) < Math.abs(best - durationSeconds) ? candidate : best
      );
  const effectiveAspectRatio = aspectRatioOptions.includes(aspectRatio)
    ? aspectRatio
    : aspectRatioOptions[0] ?? '16:9';
  const [selectedStyle, setSelectedStyle] = useState<string>('Cinematic');
  const [continuityControls, setContinuityControls] = useState<VideoContinuityControls>(DEFAULT_VIDEO_CONTINUITY_CONTROLS);
  const continuityAvailability = videoContinuityAvailability(writerDocument, loadedWriterShotId);
  const effectiveStylePreset = loadedWriterShotId !== '' && continuityControls.styleConsistency ? 'Writer Style Bible' : selectedStyle;
  // Image-to-video seed: the bytes travel inline, so no path reaches here.
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);
  const [jobInputs, setJobInputs] = useState<Readonly<Record<string, VideoInputSnapshot>>>({});
  const [jobContinuityControls, setJobContinuityControls] = useState<Readonly<Record<string, VideoContinuityControls>>>({});
  const [candidateNotes, setCandidateNotes] = useState<Readonly<Record<string, string>>>({});
  const [loadedReferenceAssetIds, setLoadedReferenceAssetIds] = useState<readonly string[]>([]);
  const [autoLoadedCharacterReferenceIds, setAutoLoadedCharacterReferenceIds] = useState<readonly string[]>([]);
  const [isChainingFrame, setIsChainingFrame] = useState(false);
  const documentRef = useRef<AiProjectDocument | null>(writerDocument ?? null);
  const candidateSaveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const [isSavingCandidate, setIsSavingCandidate] = useState(false);
  const pollTimers = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const activePollJobs = useRef<Set<string>>(new Set());
  const inFlightPollJobs = useRef<Set<string>>(new Set());
  const recoveredCandidateIds = useRef<Set<string>>(new Set());
  const recoveryGeneration = useRef(0);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const previousVideoModelId = useRef(videoModel.id);
  // Which take is being refined, and what to change about it. A note belongs to
  // one job: applying the last one to a different take would be a change nobody
  // asked for on a shot they were happy with.
  const [refiningJobId, setRefiningJobId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Nothing to report until something happens; an idle card is just noise.
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } | null>(null);
  const selectedCandidates = writerShotId === '' ? [] : (writerDocument?.generations ?? []).filter((entry) => entry.shotId === writerShotId).slice().reverse();

  useEffect(() => {
    documentRef.current = writerDocument ?? null;
  }, [writerDocument]);

  useEffect(() => {
    try {
      setContinuityControls(parseVideoContinuityPreferences(
        window.localStorage.getItem(videoContinuityPreferencesStorageKey(projectId))
      ));
    } catch {
      setContinuityControls(DEFAULT_VIDEO_CONTINUITY_CONTROLS);
    }
  }, [projectId]);

  useEffect(() => {
    void window.videoTool.getBrowserSessionStatuses().then((response) => {
      if (response.ok) setFlowSession(response.value.find((status) => status.providerId === (grokImagineBrowser ? 'grok' : 'gemini')) ?? null);
    });
  }, [grokImagineBrowser]);

  useEffect(() => {
    if (previousVideoModelId.current === videoModel.id) return;
    previousVideoModelId.current = videoModel.id;
    setGenerationMode(videoModel.id === 'grok-imagine-video-1.5' || googleFlowVideoModelFor(videoModel.id) !== null ? 'browser_session' : videoModel.executionPath);
    setSelectedOperation('text_to_video');
  }, [videoModel.id, videoModel.executionPath]);

  const persistCandidateChange = async (
    change: (document: AiProjectDocument) => GenerationReviewResult
  ): Promise<boolean> => {
    setIsSavingCandidate(true);
    const save = candidateSaveQueue.current.catch(() => false).then(async () => {
      const current = documentRef.current;
      if (current === null || onSaveAi === undefined) {
        setStatusMsg({ tone: 'warning', text: 'Open a project with an approved Writer breakdown before recording candidates.' });
        return false;
      }
      const result = change(current);
      if (!result.ok) {
        setStatusMsg({ tone: 'warning', text: result.reason });
        return false;
      }
      documentRef.current = result.document;
      const saved = await onSaveAi(result.document);
      if (!saved && documentRef.current === result.document) documentRef.current = current;
      return saved;
    });
    candidateSaveQueue.current = save;
    try {
      return await save;
    } finally {
      if (candidateSaveQueue.current === save) setIsSavingCandidate(false);
    }
  };

  const startPollingJob = (job: VideoGenerationJob, targetWriterShotId: string, pollingTimeout: number): void => {
    if (activePollJobs.current.has(job.id)) return;
    const pollingDeadline = Date.now() + pollingTimeout;
    const stopPolling = (intervalId: ReturnType<typeof setInterval>): void => {
      clearInterval(intervalId);
      pollTimers.current.delete(intervalId);
      activePollJobs.current.delete(job.id);
      inFlightPollJobs.current.delete(job.id);
    };
    const intervalId = setInterval(async () => {
      if (!activePollJobs.current.has(job.id)) return;
      if (Date.now() > pollingDeadline) {
        stopPolling(intervalId);
        setIsGenerating(activePollJobs.current.size > 0);
        setStatusMsg({ text: `Stopped waiting after ${Math.round(pollingTimeout / 60_000)} minutes. Check the terminal log for this job before retrying.`, tone: 'warning' });
        return;
      }
      if (inFlightPollJobs.current.has(job.id)) return;
      inFlightPollJobs.current.add(job.id);
      try {
        const pollRes = await window.videoTool.aiGetVideoJob(job.id);
        if (!activePollJobs.current.has(job.id)) return;
        if (!pollRes.ok || !pollRes.value) {
          stopPolling(intervalId);
          setIsGenerating(activePollJobs.current.size > 0);
          setStatusMsg({ text: !pollRes.ok ? pollRes.error.message : 'The video job could not be read.', tone: 'danger' });
          return;
        }
        const updatedJob = pollRes.value;
        setJobs((current) => current.some((entry) => entry.id === updatedJob.id)
          ? current.map((entry) => entry.id === updatedJob.id ? updatedJob : entry)
          : [updatedJob, ...current]);

        if (updatedJob.status === 'completed') {
          stopPolling(intervalId);
          setIsGenerating(activePollJobs.current.size > 0);
          if (targetWriterShotId !== '') await persistCandidateChange((document) => updateGenerationCandidate(document, job.id, {
            status: 'completed', updatedAt: updatedJob.updatedAt
          }));
          setStatusMsg({ text: 'Video generation completed! Asset ready.', tone: 'success' });
        } else if (updatedJob.status === 'needs_user_action') {
          stopPolling(intervalId);
          setIsGenerating(activePollJobs.current.size > 0);
          if (targetWriterShotId !== '') await persistCandidateChange((document) => updateGenerationCandidate(document, job.id, {
            status: 'needs_user_action', error: updatedJob.error ?? 'Browser session action is required.', updatedAt: updatedJob.updatedAt
          }));
          setStatusMsg({
            text: updatedJob.error ?? 'The signed-in browser session needs attention. Resolve it in Settings, then start a new generation.',
            tone: 'warning'
          });
        } else if (updatedJob.status === 'failed') {
          stopPolling(intervalId);
          setIsGenerating(activePollJobs.current.size > 0);
          if (targetWriterShotId !== '') await persistCandidateChange((document) => updateGenerationCandidate(document, job.id, {
            status: 'failed', error: updatedJob.error ?? 'Unknown error', updatedAt: updatedJob.updatedAt
          }));
          setStatusMsg({ text: `Generation failed: ${updatedJob.error ?? 'Unknown error'}`, tone: 'danger' });
        }
      } catch (error) {
        stopPolling(intervalId);
        setIsGenerating(activePollJobs.current.size > 0);
        setStatusMsg({ text: error instanceof Error ? error.message : 'Video job polling failed.', tone: 'danger' });
      } finally {
        inFlightPollJobs.current.delete(job.id);
      }
    }, 1000);
    pollTimers.current.add(intervalId);
    activePollJobs.current.add(job.id);
    setIsGenerating(true);
  };

  useEffect(() => {
    recoveredCandidateIds.current.clear();
    recoveryGeneration.current += 1;
  }, [projectId]);

  useEffect(() => {
    const recoverable = (writerDocument?.generations ?? []).filter((candidate) =>
      (candidate.status === 'queued' || candidate.status === 'running') &&
      !recoveredCandidateIds.current.has(candidate.id)
    );
    if (recoverable.length === 0) return;
    const runGeneration = recoveryGeneration.current;
    for (const candidate of recoverable) recoveredCandidateIds.current.add(candidate.id);
    void (async () => {
      for (const candidate of recoverable) {
        const response = await window.videoTool.aiGetVideoJob(candidate.id);
        if (recoveryGeneration.current !== runGeneration) return;
        if (!response.ok && response.error.code !== 'JOB_NOT_FOUND') {
          recoveredCandidateIds.current.delete(candidate.id);
          setStatusMsg({ tone: 'danger', text: response.error.message });
          continue;
        }
        const recoveredJob = response.ok ? response.value : null;
        if (recoveredJob !== null) {
          setJobs((current) => current.some((job) => job.id === recoveredJob.id)
            ? current.map((job) => job.id === recoveredJob.id ? recoveredJob : job)
            : [recoveredJob, ...current]);
          if (recoveredJob.status === 'queued' || recoveredJob.status === 'running') {
            startPollingJob(
              recoveredJob,
              candidate.shotId,
              recoveredJob.operation === 'motion_control' ? MOTION_JOB_UI_TIMEOUT_MS : VIDEO_JOB_UI_TIMEOUT_MS
            );
          }
        }
        const saved = await persistCandidateChange((document) => reconcileVideoCandidateAfterRestart(
          document,
          candidate.id,
          recoveredJob,
          new Date().toISOString()
        ));
        if (recoveryGeneration.current !== runGeneration) return;
        if (!saved) {
          recoveredCandidateIds.current.delete(candidate.id);
          setStatusMsg({ tone: 'danger', text: 'Interrupted candidate recovery could not be saved. Reopen the project to retry recovery.' });
          continue;
        }
        if (saved && (recoveredJob === null || recoveredJob.status === 'failed' || recoveredJob.status === 'needs_user_action')) {
          setStatusMsg({
            tone: 'warning',
            text: recoveredJob?.error ?? 'An interrupted candidate was recovered without resubmitting it to the provider.'
          });
        } else if (saved && recoveredJob?.status === 'completed') {
          setStatusMsg({ tone: 'success', text: 'A completed video job was recovered from local storage and is ready to import.' });
        }
      }
    })().catch(() => {
      if (recoveryGeneration.current === runGeneration) setStatusMsg({ tone: 'danger', text: 'Interrupted candidate recovery could not update the project.' });
    });
  }, [projectId, writerDocument]);

  const refreshMotionWorker = async (): Promise<void> => {
    setCheckingMotionWorker(true);
    try {
      const response = await window.videoTool.aiGetComfyUiMotionStatus();
      if (!response.ok) {
        setStatusMsg({ text: response.error.message, tone: 'danger' });
        return;
      }
      setMotionWorker(response.value);
    } finally {
      setCheckingMotionWorker(false);
    }
  };

  // A still handed over from Image Generation should open the first-frame path,
  // but must not knock Start-End back to image-to-video while its first frame is picked.
  useEffect(() => {
    const newlyHandedOver = referenceImage !== null && referenceImage !== previousReferenceImage.current;
    previousReferenceImage.current = referenceImage;
    if (newlyHandedOver && selectedOperation === 'text_to_video' && isVideoOperationImplemented(videoModel.id, 'image_to_video')) {
      setSelectedOperation('image_to_video');
    }
  }, [referenceImage, selectedOperation, videoModel.id]);

  useEffect(() => {
    if (!isVideoOperationImplemented(videoModel.id, selectedOperation)) {
      setSelectedOperation(getVideoModelCapabilities(videoModel.id)?.implemented[0] ?? 'text_to_video');
    }
  }, [selectedOperation, videoModel.id]);

  useEffect(() => {
    if (selectedOperation === 'motion_control') void refreshMotionWorker();
  }, [selectedOperation, videoModel.id]);

  useEffect(() => () => {
    recoveryGeneration.current += 1;
    for (const timer of pollTimers.current) clearInterval(timer);
    pollTimers.current.clear();
    activePollJobs.current.clear();
    inFlightPollJobs.current.clear();
  }, []);

  const toggleContinuityControl = (key: VideoContinuityControlKey): void => {
    const next = { ...continuityControls, [key]: !continuityControls[key] };
    setContinuityControls(next);
    try {
      window.localStorage.setItem(videoContinuityPreferencesStorageKey(projectId), JSON.stringify(next));
    } catch {
      // The controls still work for this session when storage is unavailable.
    }
    if (key === 'characterConsistency' && !next.characterConsistency && autoLoadedCharacterReferenceIds.length > 0) {
      setReferenceImages([]);
      setLoadedReferenceAssetIds((current) => current.filter((id) => !autoLoadedCharacterReferenceIds.includes(id)));
      setAutoLoadedCharacterReferenceIds([]);
      if (selectedOperation === 'reference_to_video') {
        setSelectedOperation(isVideoOperationImplemented(videoModel.id, 'text_to_video') ? 'text_to_video' : selectedOperation);
      }
      setStatusMsg({ tone: 'neutral', text: 'Character consistency disabled; automatically attached Character Bible references were removed.' });
    } else if (key === 'characterConsistency' && next.characterConsistency && loadedWriterShotId !== '') {
      setStatusMsg({ tone: 'neutral', text: 'Character consistency enabled. Re-open the approved shot to auto-load its saved character references.' });
    }
  };

  /**
   * `overrides` is how a refined take is run: it carries the previous take's
   * own prompt, length, shape and style, so asking for one change does not
   * silently apply whatever the composer happens to be set to now.
   */
  const handleGenerate = async (overrides?: {
    readonly prompt: string;
    readonly aspectRatio: '16:9' | '9:16' | '1:1';
    readonly durationSeconds: number;
    readonly stylePreset?: string;
    readonly inputs?: VideoInputSnapshot;
    readonly modelId?: string;
    readonly writerShotId?: string;
    readonly parentGenerationId?: string;
    readonly referenceAssetIds?: readonly string[];
    readonly mode?: ProviderExecutionMode;
    readonly continuityControls?: VideoContinuityControls;
  }): Promise<VideoGenerationJob | null> => {
    if (isBatchGenerating && overrides === undefined) {
      setStatusMsg({ text: 'Wait for the production video batch to finish.', tone: 'warning' });
      return null;
    }
    const candidateOperation = overrides?.inputs?.operation ?? selectedOperation;
    const targetWriterShotId = overrides?.writerShotId ?? loadedWriterShotId;
    const editablePrompt = overrides?.prompt ?? prompt;
    const targetContinuityControls = overrides?.continuityControls ?? continuityControls;
    const compiledContinuity = targetWriterShotId !== '' && documentRef.current !== null
      ? compileVideoContinuityPrompt(editablePrompt, documentRef.current, targetWriterShotId, targetContinuityControls)
      : null;
    const promptText = compiledContinuity?.prompt ?? editablePrompt;
    const effectiveContinuityControls = compiledContinuity === null
      ? targetContinuityControls
      : Object.fromEntries(VIDEO_CONTINUITY_CONTROL_KEYS.map((key) => [key, compiledContinuity.applied.includes(key)])) as VideoContinuityControls;
    if (promptText.trim().length === 0 && candidateOperation !== 'motion_control') {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return null;
    }

    const inputs: VideoInputSnapshot = overrides?.inputs ?? {
      operation: selectedOperation,
      ...(selectedOperation === 'image_to_video' || selectedOperation === 'start_end'
        ? referenceImage === null ? {} : { referenceImage }
        : {}),
      ...(selectedOperation === 'start_end' && lastFrame !== null ? { lastFrame } : {}),
      ...(selectedOperation === 'reference_to_video' ? { referenceImages } : {}),
      ...(selectedOperation === 'motion_control' && referenceImage !== null && projectId && drivingVideoAssetId
        ? { referenceImage, projectId, drivingVideoAssetId, motionMode }
        : {})
    };
    const targetModelId = overrides?.modelId ?? videoModel.id;
    const targetGenerationMode = overrides?.mode ?? generationMode;
    if (targetGenerationMode === 'browser_session' && googleFlowVideoModelFor(targetModelId) === null && targetModelId !== 'grok-imagine-video-1.5') {
      setStatusMsg({ text: 'The selected model has no exact counterpart in the signed-in browser UI. Choose API key or a supported browser model.', tone: 'warning' });
      return null;
    }
    if (!isVideoOperationImplemented(targetModelId, inputs.operation)) {
      setStatusMsg({ text: `${videoModel.label} does not implement ${inputs.operation} in this build.`, tone: 'warning' });
      return null;
    }
    if ((inputs.operation === 'image_to_video' || inputs.operation === 'start_end') && inputs.referenceImage === undefined) {
      setStatusMsg({ text: 'Choose the first frame before generating.', tone: 'warning' });
      return null;
    }
    if (inputs.operation === 'start_end' && inputs.lastFrame === undefined) {
      setStatusMsg({ text: 'Choose the last frame before generating Start-End motion.', tone: 'warning' });
      return null;
    }
    if (inputs.operation === 'reference_to_video' && (inputs.referenceImages?.length ?? 0) === 0) {
      setStatusMsg({ text: 'Choose at least one character or product reference.', tone: 'warning' });
      return null;
    }
    if (inputs.operation === 'motion_control') {
      if (!inputs.referenceImage || !inputs.projectId || !inputs.drivingVideoAssetId || !inputs.motionMode) {
        setStatusMsg({ text: 'Choose a character image and an imported driving video before Motion Control.', tone: 'warning' });
        return null;
      }
      if (motionWorker?.modes[inputs.motionMode].ready !== true) {
        setStatusMsg({ text: motionWorker?.modes[inputs.motionMode].reason ?? 'Check the ComfyUI worker before generating.', tone: 'warning' });
        return null;
      }
    }

    const flowWindowVisible = targetGenerationMode === 'browser_session' && showGoogleFlowWindow();
    setIsGenerating(true);
    setStatusMsg({
      text: targetGenerationMode === 'browser_session'
        ? flowWindowVisible ? `Opening the signed-in ${grokImagineBrowser ? 'Grok Imagine' : 'Google Flow'} window…` : `Starting the hidden signed-in ${grokImagineBrowser ? 'Grok Imagine' : 'Google Flow'} video worker…`
        : `Submitting ${videoModel.providerLabel} ${targetGenerationMode === 'local' ? 'worker' : 'cloud'} job...`,
      tone: 'neutral'
    });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt: promptText,
        aspectRatio: overrides?.aspectRatio ?? (inputs.operation === 'motion_control' ? motionAspectRatio : effectiveAspectRatio),
        durationSeconds: overrides?.durationSeconds ?? (inputs.operation === 'motion_control' && drivingVideo?.metadata
          ? Math.max(1, Math.min(30, Math.ceil(drivingVideo.metadata.durationMs / 1_000)))
          : effectiveDuration),
        stylePreset: overrides?.stylePreset ?? (inputs.operation === 'motion_control' ? 'Workflow controlled' : effectiveStylePreset),
        modelId: targetModelId,
        mode: targetGenerationMode,
        ...(targetGenerationMode === 'browser_session'
          ? { showBrowserWindow: flowWindowVisible, ...(projectName === undefined ? {} : { flowProjectName: projectName }) }
          : {}),
        ...inputs
      });

      if (response.ok && response.value) {
        const job = response.value as VideoGenerationJob;
        setJobs((prev) => [job, ...prev]);
        setJobInputs((current) => ({ ...current, [job.id]: inputs }));
        setJobContinuityControls((current) => ({ ...current, [job.id]: effectiveContinuityControls }));
        if (targetWriterShotId !== '') {
          const recorded = await persistCandidateChange((document) => addGenerationCandidate(document, {
            id: job.id,
            shotId: targetWriterShotId,
            providerId: job.provider,
            modelId: job.modelId ?? targetModelId,
            capability: inputs.operation,
            prompt: promptText,
            createdAt: job.createdAt,
            referenceAssetIds: overrides?.referenceAssetIds ?? (
              ((inputs.operation === 'image_to_video' || inputs.operation === 'start_end') && inputs.referenceImage !== undefined) ||
              (inputs.operation === 'reference_to_video' && (inputs.referenceImages?.length ?? 0) > 0)
                ? loadedReferenceAssetIds
                : []
            ),
            continuityControls: effectiveContinuityControls,
            ...(overrides?.parentGenerationId === undefined ? {} : { parentGenerationId: overrides.parentGenerationId })
          }));
          if (!recorded) {
            setStatusMsg({ text: `Job ${job.id} started, but its candidate record could not be saved. Let it finish, then do not approve it until the project is checked.`, tone: 'warning' });
          }
        }
        setStatusMsg({ text: `Job started (${job.id}). Synthesizing video frames...`, tone: 'neutral' });

        startPollingJob(
          job,
          targetWriterShotId,
          inputs.operation === 'motion_control' ? MOTION_JOB_UI_TIMEOUT_MS : VIDEO_JOB_UI_TIMEOUT_MS
        );
        return job;
      } else {
        setIsGenerating(false);
        setStatusMsg({ text: !response.ok ? response.error.message : 'Failed to start generation job.', tone: 'danger' });
        return null;
      }
    } catch (err) {
      setIsGenerating(false);
      setStatusMsg({ text: err instanceof Error ? err.message : 'Unexpected error during generation.', tone: 'danger' });
      return null;
    }
  };

  /**
   * The next take of a job, with a note about what to change.
   *
   * The previous prompt is kept whole and the change added to it by the shared
   * rule — the same one the phone uses — because a rewrite loses the parts
   * nobody mentioned, which are the parts a shot is made of.
   */
  const refineJob = (job: VideoGenerationJob): void => {
    const refined = refineShotPrompt(job.prompt, note);
    if (!refined.ok) {
      setStatusMsg({ text: refined.reason, tone: 'warning' });
      return;
    }
    setRefiningJobId(null);
    setNote('');
    // Shown in the composer as well, so what was asked for is visible rather
    // than only implied by a new job appearing.
    setPrompt(stripVideoContinuityLocks(refined.prompt));
    const sourceCandidate = documentRef.current?.generations.find((entry) => entry.id === job.id);
    void handleGenerate({
      prompt: refined.prompt,
      aspectRatio: job.aspectRatio,
      durationSeconds: job.durationSeconds,
      ...(job.modelId === undefined ? {} : { modelId: job.modelId }),
      ...(job.stylePreset === undefined ? {} : { stylePreset: job.stylePreset }),
      mode: job.mode,
      inputs: jobInputs[job.id] ?? { operation: job.operation ?? 'text_to_video' },
      continuityControls: sourceCandidate?.continuityControls ?? jobContinuityControls[job.id] ?? continuityControls,
      ...(sourceCandidate === undefined ? {} : {
        writerShotId: sourceCandidate.shotId,
        parentGenerationId: sourceCandidate.id,
        referenceAssetIds: sourceCandidate.referenceAssetIds
      })
    });
  };

  const pickReferenceImage = async (target: 'first' | 'last' | 'asset'): Promise<void> => {
    const response = await window.videoTool.aiSelectReferenceImage();
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    if (response.value === null) return;
    if (target === 'first') {
      setLoadedReferenceAssetIds([]);
      setAutoLoadedCharacterReferenceIds([]);
      onReferenceImageChange(response.value);
    }
    else if (target === 'last') setLastFrame(response.value);
    else {
      setLoadedReferenceAssetIds([]);
      setAutoLoadedCharacterReferenceIds([]);
      setReferenceImages((current) => current.length >= 3 ? current : [...current, response.value as ReferenceImageSelection]);
    }
  };

  const handleImportToProject = async (job: VideoGenerationJob): Promise<void> => {
    if (job.status !== 'completed') return;
    try {
      const status = await importAiResult(job.id);
      setStatusMsg(status);
      if (status.importedAssetId !== undefined && documentRef.current?.generations.some((entry) => entry.id === job.id)) {
        const saved = await persistCandidateChange((document) => updateGenerationCandidate(document, job.id, {
          outputAssetIds: [status.importedAssetId!], updatedAt: new Date().toISOString()
        }));
        if (saved) setStatusMsg({ tone: 'success', text: 'Candidate imported. Complete the continuity review before approval.' });
      }
    } catch (err) {
      setStatusMsg({ text: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, tone: 'danger' });
    }
  };

  const setContinuity = async (generationId: string, field: ContinuityReviewField, value: ContinuityReviewValue): Promise<void> => {
    const current = documentRef.current?.generations.find((entry) => entry.id === generationId);
    const notes = candidateNotes[generationId] ?? current?.review?.notes ?? '';
    await persistCandidateChange((document) => setCandidateContinuity(document, generationId, field, value, notes));
  };

  const decideCandidate = async (generationId: string, decision: 'approved' | 'rejected'): Promise<void> => {
    const current = documentRef.current?.generations.find((entry) => entry.id === generationId);
    const notes = candidateNotes[generationId] ?? current?.review?.notes ?? '';
    const saved = await persistCandidateChange((document) => decideGenerationCandidate(document, generationId, decision, notes, new Date().toISOString()));
    if (saved) setStatusMsg({ tone: decision === 'approved' ? 'success' : 'neutral', text: decision === 'approved'
      ? 'Candidate approved for this Writer shot. Any previously approved take was replaced.'
      : 'Candidate rejected. It remains in the project history for comparison.' });
  };

  const loadSavedStartFrame = async (shotId: string): Promise<void> => {
    const current = documentRef.current;
    if (!projectId || !current) return;
    const shot = current.shots.find((entry) => entry.id === shotId);
    const reference = shot?.referenceAssetIds
      .map((id) => current.referenceAssets.find((entry) => entry.id === id))
      .find((entry) => entry?.role === 'start_frame');
    if (reference === undefined) {
      setStatusMsg({ tone: 'warning', text: 'This Writer shot has no saved continuity start frame.' });
      return;
    }
    const response = await window.videoTool.aiGetProjectImageReference({ projectId, assetId: reference.assetId });
    if (!response.ok) {
      setStatusMsg({ tone: 'danger', text: response.error.message });
      return;
    }
    if (!isVideoOperationImplemented(videoModel.id, 'image_to_video')) {
      setStatusMsg({ tone: 'warning', text: `${videoModel.label} cannot use the saved start frame. Choose an image-to-video model.` });
      return;
    }
    onReferenceImageChange(response.value);
    setLoadedReferenceAssetIds([reference.id]);
    setAutoLoadedCharacterReferenceIds([]);
    setSelectedOperation('image_to_video');
    setStatusMsg({ tone: 'success', text: 'Saved storyboard or continuity image loaded as the first frame. Review it before generation.' });
  };

  const openProductionShot = async (shotId: string): Promise<void> => {
    const current = documentRef.current;
    const shot = approvedWriterShots(current).find((entry) => entry.id === shotId);
    if (current === null || shot === undefined) {
      setStatusMsg({ tone: 'warning', text: 'The selected production shot is no longer available.' });
      return;
    }
    if (!durationOptions.includes(shot.durationSeconds)) {
      setStatusMsg({ tone: 'warning', text: `This shot needs ${shot.durationSeconds}s; the selected model accepts ${durationOptions.join('/')}s. Choose a compatible model first.` });
      return;
    }
    setWriterShotId(shot.id);
    setLoadedWriterShotId(shot.id);
    setPrompt(shot.prompt);
    setDurationSeconds(shot.durationSeconds);
    setLoadedReferenceAssetIds([]);
    setAutoLoadedCharacterReferenceIds([]);
    setReferenceImages([]);
    onReferenceImageChange(null);

    const persistedShot = current.shots.find((entry) => entry.id === shot.id);
    const scene = persistedShot === undefined ? undefined : current.scenes.find((entry) => entry.id === persistedShot.sceneId);
    const startReference = persistedShot?.referenceAssetIds
      .map((id) => current.referenceAssets.find((entry) => entry.id === id))
      .find((entry) => entry?.role === 'start_frame');
    if (startReference !== undefined) {
      await loadSavedStartFrame(shot.id);
      return;
    }
    const characterReferences = (scene?.characterIds ?? []).flatMap((characterId) =>
      current.characters.find((entry) => entry.id === characterId)?.referenceAssetIds ?? []
    ).map((id) => current.referenceAssets.find((entry) => entry.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => entry?.role === 'character')
      .slice(0, 3);
    if (continuityControls.characterConsistency && projectId && characterReferences.length > 0 && isVideoOperationImplemented(videoModel.id, 'reference_to_video')) {
      const loaded = await Promise.all(characterReferences.map(async (reference) => ({
        reference,
        response: await window.videoTool.aiGetProjectImageReference({ projectId, assetId: reference.assetId })
      })));
      const available = loaded.flatMap((entry) => entry.response.ok
        ? [{ reference: entry.reference, value: entry.response.value }]
        : []);
      if (available.length > 0) {
        setReferenceImages(available.map((entry) => entry.value));
        setLoadedReferenceAssetIds(available.map((entry) => entry.reference.id));
        setAutoLoadedCharacterReferenceIds(available.map((entry) => entry.reference.id));
        setSelectedOperation('reference_to_video');
        setStatusMsg({ tone: 'success', text: `Shot loaded with ${available.length} persisted character reference(s). Review everything before generating.` });
        return;
      }
    }
    setSelectedOperation(isVideoOperationImplemented(videoModel.id, 'text_to_video') ? 'text_to_video' : selectedOperation);
    setStatusMsg({ tone: 'neutral', text: 'Shot loaded without a first frame. Review the prompt and choose inputs before generating.' });
  };

  type ProductionVideoBatchItem = {
    readonly shotId: string;
    readonly label: string;
    readonly prompt: string;
    readonly durationSeconds: number;
    readonly inputs: VideoInputSnapshot;
    readonly referenceAssetIds: readonly string[];
  };

  const durationOptionsForOperation = (operation: VideoOperation): readonly number[] => {
    if (generationMode === 'browser_session' && flowVideoModel !== null) return googleFlowVideoDurationOptions(flowVideoModel);
    if (generationMode === 'browser_session' && grokImagineBrowser) return [6, 10, 15];
    return getVideoOperationConstraints(videoModel.id, operation)?.durationSeconds ?? [4, 8];
  };

  const waitForVideoTerminal = async (jobId: string): Promise<'completed' | 'failed' | 'needs_user_action' | 'timeout'> => {
    const deadline = Date.now() + VIDEO_JOB_UI_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const response = await window.videoTool.aiGetVideoJob(jobId);
      if (!response.ok || response.value === null) return 'failed';
      if (response.value.status === 'completed') return 'completed';
      if (response.value.status === 'failed') return 'failed';
      if (response.value.status === 'needs_user_action') return 'needs_user_action';
    }
    return 'timeout';
  };

  const prepareProductionVideoBatch = async (): Promise<{
    readonly items: readonly ProductionVideoBatchItem[];
    readonly skipped: readonly string[];
  }> => {
    const current = documentRef.current;
    if (current === null || projectId === null || projectId === undefined) return { items: [], skipped: ['Open a project first.'] };
    const batchableShotIds = new Set(batchableProductionVideoShotIds(current));
    const eligibleRows = productionShotRows(current).filter((row) => batchableShotIds.has(row.shotId));
    const items: ProductionVideoBatchItem[] = [];
    const skipped: string[] = [];
    for (const row of eligibleRows.slice(0, PRODUCTION_BATCH_LIMIT)) {
      const writerShot = approvedWriterShots(current).find((entry) => entry.id === row.shotId);
      const persistedShot = current.shots.find((entry) => entry.id === row.shotId);
      if (writerShot === undefined || persistedShot === undefined) {
        skipped.push(`${row.label}: Writer data changed.`);
        continue;
      }
      const nearestDurationFor = (operation: VideoOperation): number => durationOptionsForOperation(operation).reduce((best, candidate) =>
        Math.abs(candidate - writerShot.durationSeconds) < Math.abs(best - writerShot.durationSeconds) ? candidate : best
      );
      const referencePlan = planProductionVideoReferences(current, row.shotId, {
        controls: continuityControls,
        supportsImageToVideo: isVideoOperationImplemented(videoModel.id, 'image_to_video'),
        supportsReferenceToVideo: isVideoOperationImplemented(videoModel.id, 'reference_to_video'),
        supportsTextToVideo: isVideoOperationImplemented(videoModel.id, 'text_to_video')
      });
      if (referencePlan.kind === 'blocked') {
        skipped.push(`${row.label}: ${referencePlan.reason}`);
        continue;
      }
      if (referencePlan.kind === 'storyboard') {
        const loaded = await window.videoTool.aiGetProjectImageReference({ projectId, assetId: referencePlan.reference.assetId });
        if (!loaded.ok) {
          skipped.push(`${row.label}: storyboard image could not be loaded.`);
          continue;
        }
        items.push({
          shotId: row.shotId,
          label: row.label,
          prompt: writerShot.prompt,
          durationSeconds: nearestDurationFor('image_to_video'),
          inputs: { operation: 'image_to_video', referenceImage: loaded.value },
          referenceAssetIds: [referencePlan.reference.id]
        });
        continue;
      }
      if (referencePlan.kind === 'characters') {
        const loaded = await Promise.all(referencePlan.references.map(async (reference) => ({
          reference,
          response: await window.videoTool.aiGetProjectImageReference({ projectId, assetId: reference.assetId })
        })));
        if (loaded.some((entry) => !entry.response.ok)) {
          skipped.push(`${row.label}: one or more character references could not be loaded.`);
          continue;
        }
        items.push({
          shotId: row.shotId,
          label: row.label,
          prompt: writerShot.prompt,
          durationSeconds: nearestDurationFor('reference_to_video'),
          inputs: { operation: 'reference_to_video', referenceImages: loaded.flatMap((entry) => entry.response.ok ? [entry.response.value] : []) },
          referenceAssetIds: referencePlan.references.map((entry) => entry.id)
        });
        continue;
      }
      items.push({
        shotId: row.shotId,
        label: row.label,
        prompt: writerShot.prompt,
        durationSeconds: nearestDurationFor('text_to_video'),
        inputs: { operation: 'text_to_video' },
        referenceAssetIds: []
      });
    }
    return { items, skipped };
  };

  const generateProductionVideoBatch = async (): Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }> => {
    if (isBatchGenerating || isGenerating) return { tone: 'warning', text: 'Another video generation job is already running.' };
    const plan = await prepareProductionVideoBatch();
    if (plan.items.length === 0) {
      return { tone: 'neutral', text: plan.skipped[0] ?? 'No not-started or failed production shots need a new candidate.' };
    }
    const estimate = estimateVideoPlanCost(plan.items.map((item) => ({ modelId: videoModel.id, durationSeconds: item.durationSeconds })));
    const adjusted = plan.items.filter((item) => {
      const source = approvedWriterShots(documentRef.current).find((entry) => entry.id === item.shotId);
      return source !== undefined && source.durationSeconds !== item.durationSeconds;
    }).length;
    const price = estimate.fullyPriced
      ? generationMode === 'browser_session'
        ? `API list-price reference: ~$${estimate.totalUsd?.toFixed(2)}; signed-in browser credits and limits may differ.`
        : `Estimated provider total: ~$${estimate.totalUsd?.toFixed(2)}.`
      : 'Provider total cannot be priced by OpenScene.';
    const confirmed = window.confirm(
      `Generate ${plan.items.length} production video(s) sequentially with ${videoModel.label}?\n\n${price}\n${adjusted > 0 ? `${adjusted} shot duration(s) will use the nearest supported model duration.\n` : ''}${plan.skipped.length > 0 ? `${plan.skipped.length} target(s) will be skipped.\n` : ''}\nEach result still requires import and continuity review. Browser-session credits may be consumed.`
    );
    if (!confirmed) return { tone: 'neutral', text: 'Production video batch cancelled before any provider job was submitted.' };
    setIsBatchGenerating(true);
    let completed = 0;
    let failed = 0;
    let attempted = 0;
    try {
      for (const [index, item] of plan.items.entries()) {
        setStatusMsg({ tone: 'neutral', text: `Production video ${index + 1}/${plan.items.length}: ${item.label}.` });
        const job = await handleGenerate({
          prompt: item.prompt,
          aspectRatio: effectiveAspectRatio,
          durationSeconds: item.durationSeconds,
          stylePreset: continuityControls.styleConsistency ? 'Writer Style Bible' : selectedStyle,
          inputs: item.inputs,
          modelId: videoModel.id,
          writerShotId: item.shotId,
          referenceAssetIds: item.referenceAssetIds,
          mode: generationMode,
          continuityControls
        });
        if (job === null) {
          attempted += 1;
          failed += 1;
          continue;
        }
        attempted += 1;
        const terminal = await waitForVideoTerminal(job.id);
        if (terminal === 'completed') completed += 1;
        else {
          failed += 1;
          if (terminal === 'needs_user_action' || terminal === 'timeout') break;
        }
      }
    } finally {
      setIsBatchGenerating(false);
    }
    const notSubmitted = plan.items.length - attempted;
    const text = `${completed}/${attempted} submitted production video job(s) completed${failed > 0 ? `; ${failed} failed or need attention` : ''}${notSubmitted > 0 ? `; ${notSubmitted} not submitted after the queue stopped` : ''}${plan.skipped.length > 0 ? `; ${plan.skipped.length} ineligible target(s) skipped` : ''}. Import and review every candidate before approval.`;
    setStatusMsg({ tone: failed === 0 ? 'success' : completed > 0 ? 'warning' : 'danger', text });
    return { tone: failed === 0 ? 'success' : completed > 0 ? 'warning' : 'danger', text };
  };

  const chainCandidateToNextShot = async (generationId: string): Promise<void> => {
    const current = documentRef.current;
    const candidate = current?.generations.find((entry) => entry.id === generationId);
    const sourceAssetId = candidate?.outputAssetIds[0];
    const nextShotId = current && candidate ? nextApprovedWriterShotId(current, candidate.shotId) : null;
    if (!projectId || !current || !candidate || sourceAssetId === undefined || nextShotId === null) {
      setStatusMsg({ tone: 'warning', text: 'This approved candidate has no following Writer shot to continue into.' });
      return;
    }
    setIsChainingFrame(true);
    setStatusMsg({ tone: 'neutral', text: 'Extracting the approved take’s final frame with FFmpeg…' });
    try {
      const extracted = await window.videoTool.aiExtractContinuationFrame({ projectId, assetId: sourceAssetId });
      if (!extracted.ok) {
        setStatusMsg({ tone: 'danger', text: extracted.error.message });
        return;
      }
      const referenceId = `continuity-${extracted.value.asset.id}`;
      const saved = await persistCandidateChange((document) => chainContinuationFrame(document, {
        sourceGenerationId: candidate.id,
        sourceAssetId,
        targetShotId: nextShotId,
        frameAssetId: extracted.value.asset.id,
        referenceId,
        label: `Approved tail frame at ${(extracted.value.sourceTimeMs / 1_000).toFixed(2)}s`
      }));
      if (!saved) return;

      const next = approvedWriterShots(documentRef.current).find((shot) => shot.id === nextShotId);
      if (next === undefined) {
        setStatusMsg({ tone: 'warning', text: 'The frame was saved, but the next Writer shot changed before it could be loaded.' });
        return;
      }
      setWriterShotId(next.id);
      setLoadedWriterShotId(next.id);
      setPrompt(next.prompt);
      setDurationSeconds(next.durationSeconds);
      setLoadedReferenceAssetIds([referenceId]);
      setAutoLoadedCharacterReferenceIds([]);
      onReferenceImageChange(extracted.value.reference);
      if (isVideoOperationImplemented(videoModel.id, 'image_to_video')) {
        setSelectedOperation('image_to_video');
        setStatusMsg({ tone: 'success', text: 'Final frame saved and loaded into the next Writer shot. Style Bible remains locked; review before generating.' });
      } else {
        setStatusMsg({ tone: 'warning', text: `Final frame saved for the next shot, but ${videoModel.label} cannot run image-to-video. Choose a compatible model.` });
      }
    } finally {
      setIsChainingFrame(false);
    }
  };

  return (
    <section className="studio-surface" aria-labelledby="video-generation-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="video-generation-title">Video Generation</h2>
          {/* The picker beside it already names the model and provider. */}
          <span className="studio-surface__title-meta">
            {generationMode === 'browser_session' ? `Signed-in ${grokImagineBrowser ? 'Grok Imagine' : 'Google Flow'} worker` : 'Cloud + user-managed local generation'}
          </span>
        </div>
        <DomainModelPicker
          domain="video-generation"
          ariaLabel="Video model"
          linkedModelIds={flowSession?.kind === 'stored'
            ? grokImagineBrowser
              ? ['grok-imagine-video-1.5']
              : ['gemini-omni-1.1-flash', 'veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview']
            : []}
        />
      </header>

      <div className="studio-surface__body">
        {writerDocument !== null && writerDocument !== undefined && onSaveAi !== undefined && projectId !== null && projectId !== undefined &&
          <ProductionBoard
            document={writerDocument}
            assets={projectAssets}
            busy={isGenerating || isBatchGenerating || isSavingCandidate || isChainingFrame}
            onSave={onSaveAi}
            onOpenShot={openProductionShot}
            onGenerateCharacterImage={(characterId) => onGenerateProductionImage({ kind: 'character_reference', characterId })}
            onGenerateStoryboardImage={(shotId) => onGenerateProductionImage({ kind: 'storyboard', shotId }, effectiveAspectRatio)}
            onGenerateImages={(targets) => onGenerateProductionImages(targets, effectiveAspectRatio)}
            onOpenImageResults={onOpenImageResults}
            onGenerateVideoBatch={generateProductionVideoBatch}
            onAssemble={assembleApprovedWriterShots}
          />}
        {browserSessionSupported && (
          <div className="studio-field">
            <span className="studio-field__label">Connection</span>
            <div className="studio-chips" role="group" aria-label={`${grokImagineBrowser ? 'Grok Imagine' : 'Google Flow'} video connection mode`}>
              <button
                type="button"
                aria-pressed={generationMode === 'browser_session'}
                className={`studio-chip${generationMode === 'browser_session' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('browser_session')}
              >
                {grokImagineBrowser ? 'Grok Imagine session' : 'Google Flow session'}
              </button>
              <button
                type="button"
                aria-pressed={generationMode === 'api'}
                disabled={grokImagineBrowser}
                className={`studio-chip${generationMode === 'api' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('api')}
              >
                API key
              </button>
            </div>
            {generationMode === 'browser_session' && (
              <StatusCard tone={flowSession?.kind === 'stored' ? 'success' : 'warning'}>
                {flowSession?.kind === 'stored'
                  ? grokImagineBrowser
                    ? 'Grok Imagine session ready. OpenScene downloads the generated MP4, then returns it to candidate review.'
                    : 'Google Flow session ready. OpenScene selects the exact Flow model, downloads the MP4, then returns it to candidate review.'
                  : `No ready ${grokImagineBrowser ? 'Grok Imagine' : 'Google Flow'} session detected. Sign in under Settings → Providers before generating.`}
              </StatusCard>
            )}
          </div>
        )}
        <div className="studio-field">
          <span className="studio-field__label">Input mode</span>
          <div className="studio-chips" role="group" aria-label="Video input mode">
            {INPUT_MODES.map((mode) => {
              const available = isVideoOperationImplemented(videoModel.id, mode.id);
              return <button key={mode.id} type="button" disabled={!available}
                title={available ? undefined : `${videoModel.label} does not implement this mode.`}
                aria-pressed={selectedOperation === mode.id}
                className={`studio-chip${selectedOperation === mode.id ? ' studio-chip--selected' : ''}`}
                onClick={() => setSelectedOperation(mode.id)}>{mode.label}</button>;
            })}
          </div>
          <span className="studio-reference__empty">
            {selectedOperation === 'start_end' ? 'Veo builds the motion between two approved frames.'
              : selectedOperation === 'reference_to_video' ? 'Attach 1-3 character or product images. This mode uses an 8-second clip.'
                : selectedOperation === 'motion_control' ? 'Transfer performance from an imported driving video with a user-managed ComfyUI Wan workflow.'
                : selectedOperation === 'image_to_video' ? 'The supplied image becomes the first frame.'
                  : 'Prompt only, without visual references.'}
          </span>
        </div>

        {selectedOperation !== 'motion_control' && <div className="studio-field">
          <span className="studio-field__label">Style</span>
          {loadedWriterShotId !== '' && writerDocument !== null && writerDocument !== undefined && continuityControls.styleConsistency
            ? <StatusCard tone="success">Writer Style Bible locked: {[...writerDocument.styleBible.palette, writerDocument.styleBible.lighting, writerDocument.styleBible.cameraGrammar, writerDocument.styleBible.texture].filter(Boolean).join(' · ') || 'approved prompt constraints'}.</StatusCard>
            : <div className="studio-chips" role="group" aria-label="Style preset">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={selectedStyle === preset}
                className={`studio-chip${selectedStyle === preset ? ' studio-chip--selected' : ''}`}
                onClick={() => setSelectedStyle(preset)}
              >
                {preset}
              </button>
            ))}
          </div>}
        </div>}

        {selectedOperation !== 'motion_control' && <div className="studio-field">
          <span className="studio-field__label">Continuity controls</span>
          <div className="studio-toggle-list">
            {VIDEO_CONTINUITY_CONTROL_KEYS.map((key) => {
              const available = loadedWriterShotId !== '' && continuityAvailability[key];
              const detail = CONTINUITY_CONTROL_DETAILS[key];
              return <div className={`studio-toggle-row${available ? '' : ' studio-toggle-row--disabled'}`} key={key}>
                <span className="studio-toggle-row__copy">
                  <span className="studio-toggle-row__name">{detail.label}</span>
                  <span className="studio-toggle-row__description">{available
                    ? detail.description
                    : loadedWriterShotId === ''
                      ? 'Load an approved Writer shot to use this control.'
                      : key === 'motionContinuity'
                        ? 'This is the first shot in its scene, so there is no previous motion to carry forward.'
                        : `This Writer shot has no ${key === 'characterConsistency' ? 'Character Bible' : 'matching scene'} data.`}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={continuityControls[key]}
                  aria-label={`${detail.label}: ${continuityControls[key] ? 'on' : 'off'}`}
                  disabled={!available}
                  className={`settings-switch${continuityControls[key] ? ' settings-switch--on' : ''}`}
                  onClick={() => toggleContinuityControl(key)}
                >
                  <span className="settings-switch__thumb" aria-hidden="true" />
                </button>
              </div>;
            })}
          </div>
          <span className="studio-reference__empty">Enabled locks are compiled into the provider prompt and saved with each candidate. Visual reference images remain visible inputs.</span>
        </div>}

        {selectedOperation !== 'motion_control' && <div className="studio-field">
          <span className="studio-field__label">Aspect ratio</span>
          <div className="studio-chips" role="group" aria-label="Aspect ratio">
            {aspectRatioOptions.map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={effectiveAspectRatio === ratio}
                className={`studio-chip${effectiveAspectRatio === ratio ? ' studio-chip--selected' : ''}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>}

        {selectedOperation !== 'motion_control' && <div className="studio-field">
          <span className="studio-field__label">Duration</span>
          <div className="studio-chips" role="group" aria-label="Duration">
            {durationOptions.map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={effectiveDuration === sec}
                className={`studio-chip${effectiveDuration === sec ? ' studio-chip--selected' : ''}`}
                onClick={() => setDurationSeconds(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>}

        {statusMsg !== null && <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>}

        {(selectedOperation === 'image_to_video' || selectedOperation === 'start_end' || selectedOperation === 'motion_control') && <div className="studio-field">
          <span className="studio-field__label">{selectedOperation === 'motion_control' ? 'Character image' : 'First frame'}</span>
          {referenceImage === null ? (
            <div className="studio-reference">
              <span className="studio-reference__empty">
                Required. Review this image before generation.
              </span>
              <Button variant="ghost" onClick={() => void pickReferenceImage('first')}>{selectedOperation === 'motion_control' ? 'Choose character image' : 'Choose first frame'}</Button>
            </div>
          ) : (
            <div className="studio-reference">
              <img
                className="studio-reference__thumb"
                src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`}
                alt={`Reference image ${referenceImage.displayName}`}
              />
              <span className="studio-reference__name">{referenceImage.displayName}</span>
              <Button variant="ghost" onClick={() => {
                setLoadedReferenceAssetIds([]);
                onReferenceImageChange(null);
              }} aria-label="Remove first frame">
                Remove
              </Button>
            </div>
          )}
        </div>}

        {selectedOperation === 'motion_control' && <>
          <div className="studio-field">
            <span className="studio-field__label">Motion method</span>
            <div className="studio-chips" role="group" aria-label="Motion method">
              {(['move', 'mix'] as const).map((mode) => <button key={mode} type="button"
                aria-pressed={motionMode === mode}
                className={`studio-chip${motionMode === mode ? ' studio-chip--selected' : ''}`}
                onClick={() => setMotionMode(mode)}>{mode === 'move' ? 'Move · transfer motion' : 'Mix · replace character'}</button>)}
            </div>
            <span className="studio-reference__empty">{motionMode === 'move'
              ? 'Move preserves the character image and transfers the driving performance.'
              : 'Mix uses the driving scene while replacing its performer with the character reference.'}</span>
          </div>
          <div className="studio-field">
            <label className="studio-field__label" htmlFor="motion-driving-video">Driving video</label>
            <select id="motion-driving-video" value={drivingVideoAssetId} onChange={(event) => setDrivingVideoAssetId(event.target.value)}>
              <option value="">Choose an imported project video</option>
              {drivingVideoAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}{asset.metadata ? ` · ${Math.ceil(asset.metadata.durationMs / 1_000)}s` : ''}</option>)}
            </select>
            {drivingVideo && drivingVideo.metadata === null && <StatusCard tone="warning">This asset has no verified duration metadata. Re-import it before Motion Control.</StatusCard>}
            {drivingVideo?.metadata && drivingVideo.metadata.durationMs > 30_000 && <StatusCard tone="warning">Trim the driving clip to 30 seconds or less before generation.</StatusCard>}
            {drivingVideo?.metadata && drivingVideo.metadata.durationMs <= 30_000 && <span className="studio-reference__empty">Output length and framing follow the driving clip and configured workflow.</span>}
          </div>
          <div className="studio-field">
            <span className="studio-field__label">ComfyUI worker</span>
            <StatusCard tone={motionWorker?.modes[motionMode].ready ? 'success' : motionWorker ? 'warning' : 'neutral'}>
              {motionWorker === null ? 'Worker not checked.' : `${motionWorker.endpoint} · ${motionWorker.modes[motionMode].ready ? 'ready' : motionWorker.modes[motionMode].reason ?? motionWorker.reason ?? motionWorker.state}${motionWorker.deviceName ? ` · ${motionWorker.deviceName}` : ''}${motionWorker.totalVramMb ? ` · ${motionWorker.freeVramMb ?? '?'} / ${motionWorker.totalVramMb} MB VRAM free` : ''}`}
            </StatusCard>
            <Button variant="ghost" disabled={checkingMotionWorker} onClick={() => void refreshMotionWorker()}>{checkingMotionWorker ? 'Checking…' : 'Refresh worker'}</Button>
          </div>
        </>}

        {selectedOperation === 'start_end' && <div className="studio-field">
          <span className="studio-field__label">Last frame</span>
          {lastFrame === null ? <div className="studio-reference">
            <span className="studio-reference__empty">Required. Veo interpolates motion toward this ending.</span>
            <Button variant="ghost" onClick={() => void pickReferenceImage('last')}>Choose last frame</Button>
          </div> : <div className="studio-reference">
            <img className="studio-reference__thumb" src={`data:${lastFrame.mimeType};base64,${lastFrame.base64}`} alt={`Last frame ${lastFrame.displayName}`} />
            <span className="studio-reference__name">{lastFrame.displayName}</span>
            <Button variant="ghost" onClick={() => setLastFrame(null)} aria-label="Remove last frame">Remove</Button>
          </div>}
        </div>}

        {selectedOperation === 'reference_to_video' && <div className="studio-field">
          <span className="studio-field__label">Character / product references ({referenceImages.length}/3)</span>
          {referenceImages.map((image, index) => <div className="studio-reference" key={`${image.displayName}-${index}`}>
            <img className="studio-reference__thumb" src={`data:${image.mimeType};base64,${image.base64}`} alt={`Asset reference ${image.displayName}`} />
            <span className="studio-reference__name">{image.displayName}</span>
            <Button variant="ghost" onClick={() => {
              // Once the loaded set is edited, its persisted IDs no longer map
              // one-to-one to the bytes sent. Keep the candidate record honest.
              setLoadedReferenceAssetIds([]);
              setReferenceImages((current) => current.filter((_, position) => position !== index));
            }} aria-label={`Remove asset reference ${index + 1}`}>Remove</Button>
          </div>)}
          <div className="studio-reference">
            <span className="studio-reference__empty">Order references deliberately; nothing is attached automatically.</span>
            <Button variant="ghost" disabled={referenceImages.length >= 3} onClick={() => void pickReferenceImage('asset')}>Add reference</Button>
          </div>
        </div>}

        <div className="studio-field">
          <span className="studio-field__label">Jobs</span>
          {jobs.length === 0 ? (
            <p className="studio-empty">No generation jobs yet.</p>
          ) : (
            <ul className="studio-job-list">
              {jobs.map((job) => (
                <li key={job.id} className="studio-job">
                  <div className="studio-job__row">
                    <span className={`studio-job__status studio-job__status--${job.status}`}>{job.status}</span>
                    <span className="studio-job__provider">{job.provider}</span>
                    <span className="studio-job__provider">{job.operation ?? 'text_to_video'}</span>
                  </div>
                  <p className="studio-job__prompt">{originalOf(stripVideoContinuityLocks(job.prompt))}</p>
                  {revisionsOf(stripVideoContinuityLocks(job.prompt)).length > 0 && (
                    <ol className="studio-job__revisions">
                      {revisionsOf(stripVideoContinuityLocks(job.prompt)).map((revision) => (
                        <li key={revision}>{revision}</li>
                      ))}
                    </ol>
                  )}
                  {job.status === 'completed' && job.previewUrl !== undefined && (
                    <video className="studio-job__preview" controls preload="metadata" src={job.previewUrl}>
                      Generated video preview is unavailable in this renderer.
                    </video>
                  )}
                  {job.status === 'completed' && (
                    <Button variant="primary" disabled={(writerDocument?.generations.find((entry) => entry.id === job.id)?.outputAssetIds.length ?? 0) > 0} onClick={() => void handleImportToProject(job)}>
                      {(writerDocument?.generations.find((entry) => entry.id === job.id)?.outputAssetIds.length ?? 0) > 0 ? 'Imported' : 'Import to project'}
                    </Button>
                  )}
                  {(job.status === 'failed' || job.status === 'needs_user_action') && job.error !== undefined && (
                    <p className="studio-job__error">{job.error}</p>
                  )}
                  {(job.status === 'completed' || job.status === 'failed' || job.status === 'needs_user_action') && (
                    <Button
                      variant="ghost"
                      disabled={isGenerating}
                      onClick={() => {
                        setNote('');
                        setRefiningJobId(refiningJobId === job.id ? null : job.id);
                      }}
                    >
                      {refiningJobId === job.id ? 'Cancel' : 'Refine'}
                    </Button>
                  )}
                  {refiningJobId === job.id && (
                    <div className="studio-refine">
                      <textarea
                        className="studio-refine__input"
                        rows={2}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="What to change — slower, no text on screen…"
                        aria-label={`What to change about this take`}
                      />
                      <Button variant="primary" disabled={note.trim().length === 0} onClick={() => refineJob(job)}>
                        Generate next take
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="studio-field">
          <span className="studio-field__label">Shot candidates & continuity approval</span>
          {writerShotId === '' ? (
            <p className="studio-empty">Choose an approved Writer shot below. Generations without a Writer shot remain ad-hoc jobs and cannot be continuity-approved.</p>
          ) : selectedCandidates.length === 0 ? (
            <p className="studio-empty">No saved candidates for this shot yet. The next generation will be recorded here.</p>
          ) : (
            <ul className="studio-job-list">
              {selectedCandidates.map((candidate) => {
                const review = candidate.review ?? { decision: 'pending' as const, continuity: emptyContinuityReview(), notes: '' };
                const outputNames = candidate.outputAssetIds.map((assetId) => projectAssets.find((asset) => asset.id === assetId)?.displayName ?? assetId);
                return (
                  <li key={candidate.id} className="studio-job studio-candidate">
                    <div className="studio-job__row">
                      <span className={`studio-job__status studio-job__status--${candidate.status}`}>{candidate.status}</span>
                      <span className="studio-job__provider">{candidate.modelId}</span>
                      <span className={`studio-candidate__decision studio-candidate__decision--${review.decision}`}>{review.decision}</span>
                    </div>
                    <p className="studio-job__prompt">{originalOf(stripVideoContinuityLocks(candidate.prompt))}</p>
                    {candidate.continuityControls !== undefined && <p className="studio-reference__empty">
                      Generation locks: {VIDEO_CONTINUITY_CONTROL_KEYS
                        .filter((key) => candidate.continuityControls?.[key])
                        .map((key) => CONTINUITY_CONTROL_DETAILS[key].label)
                        .join(', ') || 'none'}.
                    </p>}
                    {outputNames.length === 0
                      ? <p className="studio-reference__empty">Not imported. Import the completed job above before approval.</p>
                      : <p className="studio-reference__empty">Project asset: {outputNames.join(', ')}</p>}
                    {(candidate.status === 'failed' || candidate.status === 'needs_user_action') && candidate.error !== undefined && <p className="studio-job__error">{candidate.error}</p>}
                    <div className="studio-candidate__checklist" aria-label="Human continuity review">
                      {CONTINUITY_REVIEW_FIELDS.map((field) => (
                        <div className="studio-candidate__check" key={field}>
                          <span>{CONTINUITY_LABELS[field]}</span>
                          <div className="studio-chips" role="group" aria-label={CONTINUITY_LABELS[field]}>
                            {REVIEW_VALUES.map((value) => <button key={value} type="button"
                              disabled={isSavingCandidate}
                              aria-pressed={review.continuity[field] === value}
                              className={`studio-chip${review.continuity[field] === value ? ' studio-chip--selected' : ''}`}
                              onClick={() => void setContinuity(candidate.id, field, value)}>{value}</button>)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <textarea className="studio-refine__input" rows={2}
                      disabled={isSavingCandidate}
                      value={candidateNotes[candidate.id] ?? review.notes}
                      onChange={(event) => setCandidateNotes((current) => ({ ...current, [candidate.id]: event.target.value }))}
                      onBlur={() => {
                        const notes = candidateNotes[candidate.id];
                        if (notes !== undefined && notes !== review.notes) void persistCandidateChange((document) => setCandidateReviewNotes(document, candidate.id, notes));
                      }}
                      placeholder="Review notes; required when accepting a warning."
                      aria-label="Candidate review notes" />
                    <div className="studio-candidate__actions">
                      <Button variant="primary" disabled={isSavingCandidate || review.decision === 'approved'} onClick={() => void decideCandidate(candidate.id, 'approved')}>Approve candidate</Button>
                      <Button variant="ghost" disabled={isSavingCandidate || review.decision === 'rejected'} onClick={() => void decideCandidate(candidate.id, 'rejected')}>Reject</Button>
                      {review.decision === 'approved' && candidate.outputAssetIds[0] !== undefined && <Button variant="ghost" disabled={isSavingCandidate} onClick={() => {
                        const placed = placeAiAssetOnTimeline(candidate.outputAssetIds[0]!);
                        setStatusMsg({ tone: placed ? 'success' : 'warning', text: placed
                          ? 'Approved candidate added to the timeline. Review the cut, then save the timeline.'
                          : 'The approved asset could not be placed. Wait for metadata probing or add a compatible video track.' });
                      }}>Add approved to timeline</Button>}
                      {review.decision === 'approved' && candidate.outputAssetIds[0] !== undefined && nextApprovedWriterShotId(writerDocument!, candidate.shotId) !== null &&
                        <Button variant="ghost" disabled={isSavingCandidate || isChainingFrame} onClick={() => void chainCandidateToNextShot(candidate.id)}>
                          {isChainingFrame ? 'Extracting frame…' : 'Chain final frame to next shot'}
                        </Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Composer mirrors the chat prompt card: write, then act. */}
      <div className="studio-composer">
        {writerShots.length > 0 && <div className="studio-field">
          <label className="studio-field__label" htmlFor="writer-video-shot">Approved Writer shot</label>
          <select id="writer-video-shot" disabled={isGenerating} value={writerShotId} onChange={(e) => {
            setWriterShotId(e.target.value);
            setLoadedWriterShotId('');
            setLoadedReferenceAssetIds([]);
            setAutoLoadedCharacterReferenceIds([]);
            onReferenceImageChange(null);
          }}>
            <option value="">Choose a shot to load into the composer</option>
            {writerShots.map((shot) => <option key={shot.id} value={shot.id}>{shot.label}</option>)}
          </select>
          <Button disabled={isGenerating || !writerShots.some((s) => s.id === writerShotId)} onClick={() => void openProductionShot(writerShotId)}>Use approved shot (no generation)</Button>
          {writerShotId !== '' && writerShots.find((shot) => shot.id === writerShotId)?.referenceAssetIds.some((referenceId) =>
            writerDocument?.referenceAssets.some((reference) => reference.id === referenceId && reference.role === 'start_frame')) === true &&
            <Button disabled={isGenerating || isChainingFrame} onClick={() => void loadSavedStartFrame(writerShotId)}>Load saved continuity frame</Button>}
          <span className="studio-reference__empty">{loadedWriterShotId === writerShotId && writerShotId !== ''
            ? `The next generation will be saved as a candidate for this Writer shot${loadedReferenceAssetIds.length > 0 ? ` with ${loadedReferenceAssetIds.length} persisted reference(s)` : ''}.`
            : 'Select a shot and press Use approved shot before generation to link the candidate.'}</span>
        </div>}
        <textarea
          className="studio-composer__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the shot…"
          aria-label="Video prompt"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">
            {selectedOperation === 'motion_control' && drivingVideo?.metadata
              ? `${Math.ceil(drivingVideo.metadata.durationMs / 1_000)}s · ${motionAspectRatio} · ${motionMode} · workflow controlled`
              : `${effectiveDuration}s · ${effectiveAspectRatio} · ${effectiveStylePreset} · ${selectedOperation}`}
          </span>
          <Button variant="primary" onClick={() => void handleGenerate()} disabled={isGenerating || isBatchGenerating || (prompt.trim().length === 0 && selectedOperation !== 'motion_control') || !operationAvailable
            || ((selectedOperation === 'image_to_video' || selectedOperation === 'start_end' || selectedOperation === 'motion_control') && referenceImage === null)
            || (selectedOperation === 'start_end' && lastFrame === null)
            || (selectedOperation === 'reference_to_video' && referenceImages.length === 0)
            || (selectedOperation === 'motion_control' && (!projectId || !drivingVideoAssetId || !drivingVideo?.metadata || drivingVideo.metadata.durationMs > 30_000 || motionWorker?.modes[motionMode].ready !== true))}>
            {isBatchGenerating ? 'Batch generating…' : isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
