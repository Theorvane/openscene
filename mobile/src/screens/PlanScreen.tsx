import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';

import { planVideoStoryboard, supportedShotSeconds, CONTINUITY_KEYS } from '@openvideo/shared/videoStoryboardPlan';
import { composeShotPrompt, refineShotPrompt, revisionsOf, takeLabel } from '@openvideo/shared/shotPrompt';
import { getDomainModels, isDomainModelAvailableOnRuntime } from '@openvideo/shared/aiDomainModels';
import { approvedWriterShots } from '@openvideo/shared/writerPipeline';
import {
  CONTINUITY_REVIEW_FIELDS,
  type ContinuityReview,
  type ContinuityReviewField,
  type ContinuityReviewValue
} from '@openvideo/shared/aiProjectDomain';
import { candidateApprovalBlockReason, emptyContinuityReview } from '@openvideo/shared/generationReview';
import { activeStyleReference, productionShotRows } from '@openvideo/shared/productionWorkflow';
import { getVideoOperationConstraints, isVideoOperationImplemented, type VideoOperation } from '@openvideo/shared/mediaCapabilityRegistry';
import { ModelSelect } from '../components/ModelSelect';
import { supportsReferenceImage, type VideoAspectRatio, type VideoProgressStage } from '@openvideo/shared/videoGeneration';
import { isFrameExtractionAvailable } from '../../modules/video-export';
import { readProviderConnections } from '../lib/mediaProviders';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { generateShot } from '../lib/videoGeneration';
import { appendAssetToTimeline, assembleApprovedWriterShots, assetUri, clipIdForAsset, readProject, replaceTakeInTimeline, saveGeneratedVideoCandidate, type MobileAsset } from '../lib/projectStore';
import { SpendPrompt } from '../components/SpendPrompt';
import { FormScreen } from '../components/FormScreen';
import { useRevealOnFocus } from '../components/KeyboardAwareScroll';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/** Per-shot state, so a failure names the shot that failed. */
type ShotState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly stage: VideoProgressStage }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * What was actually asked of the model for one shot, kept so it can be asked
 * again with a change rather than retyped from memory.
 *
 * The clip is remembered too: a second take stands where the first one did, so
 * the cut around it survives.
 */
type ShotTake = {
  readonly prompt: string;
  readonly takeNumber: number;
  readonly assetId: string;
  readonly decision: 'pending' | 'approved' | 'rejected';
  readonly continuityReview: ContinuityReview;
  readonly reviewNotes: string;
  readonly clipId?: string;
  readonly operation?: VideoOperation;
  /** The frame this shot started from, so a redo continues from the same place. */
  readonly startFrame?: { readonly base64: string; readonly mimeType: string };
  readonly lastFrame?: { readonly base64: string; readonly mimeType: string };
  readonly referenceImages?: readonly { readonly base64: string; readonly mimeType: string }[];
};

const REVIEW_LABELS: Readonly<Record<ContinuityReviewField, string>> = {
  identity: 'Identity',
  wardrobeProps: 'Wardrobe / props',
  settingPalette: 'Setting / palette',
  motionDirection: 'Motion direction',
  boundaryMatch: 'Start / end boundary'
};
const REVIEW_VALUES: readonly Exclude<ContinuityReviewValue, 'unchecked'>[] = ['pass', 'warning', 'fail'];

const LENGTHS = [8, 16, 30, 45, 60] as const;
const INPUT_MODES: readonly { readonly id: VideoOperation; readonly label: string }[] = [
  { id: 'text_to_video', label: 'Text' },
  { id: 'image_to_video', label: 'First frame' },
  { id: 'start_end', label: 'Start-End' },
  { id: 'reference_to_video', label: 'References' },
  { id: 'motion_control', label: 'Motion · desktop' }
];
type PickedReference = { readonly displayName: string; readonly base64: string; readonly mimeType: string };

export function PlanScreen({
  topInset,
  keyboardOffset,
  projectId,
  connectionsVersion
}: {
  readonly topInset: number;
  /** Height of the chrome above this screen; see FormScreen. */
  readonly keyboardOffset: number;
  readonly projectId: string | null;
  /** Changes when Settings closes, so stored keys are picked up. */
  readonly connectionsVersion: number;
}) {
  const catalog = getDomainModels('video-generation');
  const [totalSeconds, setTotalSeconds] = useState<number>(30);
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => isDomainModelAvailableOnRuntime(entry, 'mobile'))?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [prompt, setPrompt] = useState('');
  const [writerMessage, setWriterMessage] = useState('');
  const activeProject = projectId === null ? null : readProject(projectId);
  const writerShots = approvedWriterShots(activeProject?.ai);
  const productionRows = productionShotRows(activeProject?.ai);
  const styleReference = activeProject === null || activeProject === undefined ? undefined : activeStyleReference(activeProject.ai);
  const styleReferenceAsset = activeProject?.assets.find((asset) => asset.id === styleReference?.assetId);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [shotStates, setShotStates] = useState<readonly ShotState[]>([]);
  // Keyed by shot index, because the plan can change under them and an array
  // would quietly re-index somebody's notes onto the wrong shot.
  const [descriptions, setDescriptions] = useState<Readonly<Record<number, string>>>({});
  const [takes, setTakes] = useState<Readonly<Record<number, ShotTake>>>({});
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [redoing, setRedoing] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [continuity, setContinuity] = useState(true);
  const [operation, setOperation] = useState<VideoOperation>('text_to_video');
  const [firstFrame, setFirstFrame] = useState<PickedReference | null>(null);
  const [lastFrame, setLastFrame] = useState<PickedReference | null>(null);
  const [assetReferences, setAssetReferences] = useState<readonly PickedReference[]>([]);
  const [asking, setAsking] = useState(false);
  const permissions = useSpendPermissions();
  const reveal = useRevealOnFocus();
  const promptInput = useRef<TextInput>(null);

  // Connection is reported by provider id, which is what the picker keys on.
  const refreshConnections = useCallback((): void => {
    void readProviderConnections().then(setConnected);
  }, []);

  useEffect(refreshConnections, [refreshConnections, connectionsVersion]);

  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const operationConstraints = getVideoOperationConstraints(model.id, operation)
    ?? getVideoOperationConstraints(model.id, 'text_to_video');
  const aspectRatioOptions = operationConstraints?.aspectRatios ?? ['16:9'];
  const effectiveAspectRatio: VideoAspectRatio = aspectRatioOptions.includes(aspectRatio)
    ? aspectRatio
    : aspectRatioOptions[0] ?? '16:9';
  const plan = useMemo(
    () => planVideoStoryboard({ totalSeconds, providerId: model.providerId, modelId: model.id }),
    [totalSeconds, model.id, model.providerId]
  );

  useEffect(() => {
    if (!isVideoOperationImplemented(model.id, operation)) setOperation('text_to_video');
  }, [model.id, operation]);

  // Changing anything about the plan clears the last run's results. Leaving them
  // on screen next to a different plan and a different price would misreport
  // what was actually generated.
  const setPlan = (next: () => void): void => {
    setShotStates([]);
    // The takes belong to the plan that produced them. Keeping them next to a
    // different plan would offer to refine a shot that no longer exists.
    setTakes({});
    setNoteFor(null);
    next();
  };

  const pickReference = async (target: 'first' | 'last' | 'asset'): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setWriterMessage('Photo-library permission is required to choose a video reference.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, base64: true
    });
    const file = picked.assets?.[0];
    if (picked.canceled || file === undefined || !file.base64) return;
    const image: PickedReference = {
      displayName: file.fileName ?? `reference-${Date.now()}.jpg`,
      base64: file.base64,
      mimeType: file.mimeType ?? 'image/jpeg'
    };
    if (target === 'first') setFirstFrame(image);
    else if (target === 'last') setLastFrame(image);
    else setAssetReferences((current) => current.length >= 3 ? current : [...current, image]);
  };

  /**
   * Shots run one at a time, each continuing from the last frame of the one
   * before it.
   *
   * Sequential is not only about spend. Every shot is rendered blind, so the
   * only thing that makes a sequence look like one piece is handing the tail of
   * each shot to the next as its first frame — and that cannot be done while
   * they run in parallel, because the frame does not exist yet.
   */
  const runGeneration = async (): Promise<void> => {
    if (projectId === null || model === undefined) return;
    setRunning(true);
    setShotStates(plan.shots.map(() => ({ kind: 'idle' })));
    let carriedFrame: { base64: string; mimeType: string } | undefined;

    for (const [index, shot] of plan.shots.entries()) {
      const mark = (state: ShotState): void =>
        setShotStates((current) => current.map((entry, position) => (position === index ? state : entry)));
      mark({ kind: 'running', stage: 'submitting' });

      // Composed by the shared rule rather than here, so the phone, the desktop
      // studio and the agent all send the same words for the same shot.
      const shotPrompt = composeShotPrompt({
        scenario: prompt.trim(),
        index: shot.index,
        count: plan.shots.length,
        durationSeconds: shot.durationSeconds,
        ...(descriptions[shot.index]?.trim() ? { description: descriptions[shot.index]!.trim() } : {}),
        continuity: plan.shots.length === 1 ? 'none' : carriedFrame === undefined ? 'restate' : 'from-frame'
      });
      const firstShotFrame = index === 0 && (operation === 'image_to_video' || operation === 'start_end')
        ? firstFrame ?? undefined
        : carriedFrame;
      const startFrame = firstShotFrame;
      const shotOperation: VideoOperation = carriedFrame !== undefined
        ? 'image_to_video'
        : index === 0 ? operation : 'text_to_video';

      const result = await generateShot({
        projectId,
        modelId: model.id,
        prompt: shotPrompt,
        aspectRatio: effectiveAspectRatio,
        durationSeconds: shot.durationSeconds,
        operation: shotOperation,
        ...(firstShotFrame === undefined ? {} : { referenceImage: firstShotFrame }),
        ...(operation === 'start_end' && lastFrame !== null ? { lastFrame } : {}),
        ...(operation === 'reference_to_video' ? { referenceImages: assetReferences } : {}),
        onProgress: (stage) => mark({ kind: 'running', stage })
      });

      if (!result.ok) {
        mark({ kind: 'failed', message: result.message });
        // Stopping on the first failure: the remaining shots would charge for a
        // sequence the user can no longer assemble as planned.
        break;
      }

      carriedFrame = continuity ? result.tailFrame : undefined;

      const project = readProject(projectId);
      if (project === null) {
        mark({ kind: 'failed', message: 'The project could not be read to save this shot.' });
        break;
      }
      saveGeneratedVideoCandidate(project, result.asset);
      // Kept so this shot can be asked for again with a change: the prompt to
      // build on, the clip the next take stands in for, and the frame this one
      // started from.
      setTakes((current) => ({
        ...current,
        [shot.index]: {
          prompt: shotPrompt,
          takeNumber: 1,
          assetId: result.asset.id,
          decision: 'pending',
          continuityReview: emptyContinuityReview(),
          reviewNotes: '',
          operation: shotOperation,
          ...(startFrame === undefined ? {} : { startFrame }),
          ...(shotOperation === 'start_end' && lastFrame !== null ? { lastFrame } : {}),
          ...(shotOperation === 'reference_to_video' ? { referenceImages: assetReferences } : {})
        }
      }));
      mark({ kind: 'done' });
    }

    setRunning(false);
  };

  /**
   * Ask for one shot again, with a note about what to change.
   *
   * Only that shot runs. Redoing a five-shot plan to fix the third one charged
   * for the other four, which is why this exists at all — and the new take
   * stands in the same place as the old one, so the cut around it survives.
   */
  const redoShot = async (index: number, changeNote: string): Promise<void> => {
    const take = takes[index];
    const shot = plan.shots.find((candidate) => candidate.index === index);
    if (projectId === null || model === undefined || take === undefined || shot === undefined) return;

    const refined = refineShotPrompt(take.prompt, changeNote);
    if (!refined.ok) {
      setShotStates((current) => current.map((entry, position) => (position === index - 1 ? { kind: 'failed', message: refined.reason } : entry)));
      return;
    }

    setRedoing(index);
    setNoteFor(null);
    setNote('');
    const mark = (state: ShotState): void =>
      setShotStates((current) => current.map((entry, position) => (position === index - 1 ? state : entry)));
    mark({ kind: 'running', stage: 'submitting' });

    const result = await generateShot({
      projectId,
      modelId: model.id,
      prompt: refined.prompt,
      aspectRatio: effectiveAspectRatio,
      durationSeconds: shot.durationSeconds,
      operation: take.operation ?? (take.startFrame === undefined ? 'text_to_video' : 'image_to_video'),
      // The same frame this shot started from, so a redo continues from where
      // the one before it left off rather than from nothing.
      ...(take.startFrame === undefined ? {} : { referenceImage: take.startFrame }),
      ...(take.lastFrame === undefined ? {} : { lastFrame: take.lastFrame }),
      ...(take.referenceImages === undefined ? {} : { referenceImages: take.referenceImages }),
      onProgress: (stage) => mark({ kind: 'running', stage })
    });
    setRedoing(null);

    if (!result.ok) {
      mark({ kind: 'failed', message: result.message });
      return;
    }

    const project = readProject(projectId);
    if (project === null) {
      mark({ kind: 'failed', message: 'The project could not be read to save this take.' });
      return;
    }

    // Keep the new take in the library. The existing approved clip stays on the
    // timeline until this candidate passes review and the user approves it.
    saveGeneratedVideoCandidate(project, result.asset);

    setTakes((current) => ({
      ...current,
      [index]: {
        ...take,
        prompt: refined.prompt,
        takeNumber: take.takeNumber + 1,
        assetId: result.asset.id,
        decision: 'pending',
        continuityReview: emptyContinuityReview(),
        reviewNotes: ''
      }
    }));
    mark({ kind: 'done' });
  };

  const reviewTake = (index: number, field: ContinuityReviewField, value: ContinuityReviewValue): void => {
    setTakes((current) => {
      const take = current[index];
      return take === undefined ? current : {
        ...current,
        [index]: { ...take, decision: 'pending', continuityReview: { ...take.continuityReview, [field]: value } }
      };
    });
  };

  const approveTake = (index: number): void => {
    const take = takes[index];
    if (projectId === null || take === undefined) return;
    const blocked = candidateApprovalBlockReason({
      status: 'completed',
      outputAssetIds: [take.assetId],
      review: { decision: take.decision, continuity: take.continuityReview, notes: take.reviewNotes }
    });
    if (blocked !== null) {
      setShotStates((current) => current.map((entry, position) => position === index - 1 ? { kind: 'failed', message: blocked } : entry));
      return;
    }
    const project = readProject(projectId);
    const asset = project?.assets.find((entry) => entry.id === take.assetId);
    if (project === null || asset === undefined) {
      setWriterMessage('This candidate is no longer available in the project library.');
      return;
    }
    const placed = take.clipId === undefined
      ? appendAssetToTimeline(project, asset)
      : replaceTakeInTimeline(project, take.clipId, asset) ?? appendAssetToTimeline(project, asset);
    if (placed === null) {
      setWriterMessage('The candidate is safe in the library, but no video track could accept it.');
      return;
    }
    const clipId = take.clipId ?? clipIdForAsset(placed, asset.id) ?? undefined;
    setTakes((current) => ({
      ...current,
      [index]: { ...take, decision: 'approved', ...(clipId === undefined ? {} : { clipId }) }
    }));
    setWriterMessage(`Take ${take.takeNumber} approved and placed on the timeline.`);
    setShotStates((current) => current.map((entry, position) => position === index - 1 ? { kind: 'done' } : entry));
  };

  const start = (): void => {
    const standing = permissions.standingFor('video-generation');
    if (standing === 'reject') {
      setShotStates([{ kind: 'failed', message: 'Video generation is set to never charge. Change it in Settings.' }]);
      return;
    }
    if (standing === 'always') {
      void runGeneration();
      return;
    }
    setAsking(true);
  };

  const decide = (decision: Decision): void => {
    setAsking(false);
    permissions.remember('video-generation', decision);
    if (decision !== 'reject') void runGeneration();
  };

  /**
   * What the tap will run, in place of what it will cost.
   *
   * The estimate is still computed — the agent quotes it, and the desktop shows
   * it — but this screen no longer puts a price panel in front of a decision the
   * user already made when they chose the model and the length.
   */
  /** Chaining needs both a provider that accepts a frame and a build that can read one. */
  const continuityPossible = operation !== 'reference_to_video' && operation !== 'start_end'
    && isFrameExtractionAvailable && supportsReferenceImage(model?.id ?? '');

  const runLine = `${plan.shots.length} shot${plan.shots.length === 1 ? '' : 's'} · ${plan.totalSeconds}s`;
  const canGenerate =
    projectId !== null && !running && prompt.trim().length > 0 && connected[model?.providerId ?? ''] === true
    && isVideoOperationImplemented(model.id, operation)
    && (operation !== 'image_to_video' || firstFrame !== null)
    && (operation !== 'start_end' || (plan.shots.length === 1 && firstFrame !== null && lastFrame !== null))
    && (operation !== 'reference_to_video' || (plan.shots.length === 1 && assetReferences.length > 0));

  return (
    <FormScreen topInset={topInset} keyboardOffset={keyboardOffset}>
      {productionRows.length > 0 && <View style={styles.reviewCard}>
        <Text style={styles.label}>Storyboard production board</Text>
        <Text style={styles.body}>{productionRows.filter((row) => row.state === 'approved').length}/{productionRows.length} Writer shots approved. Opening and generation remain manual.</Text>
        <Text style={styles.body}>World/style reference: {styleReferenceAsset?.displayName ?? styleReference?.label ?? 'Not assigned'}</Text>
        {productionRows.map((row, index) => <View style={styles.shot} key={row.shotId}>
          <Text style={styles.shotIndex}>{String(index + 1).padStart(2, '0')}</Text>
          <Text style={styles.shotBody}>{row.label}</Text>
          <Text style={styles.shotLen}>{row.state.replace('_', ' ')}</Text>
        </View>)}
        <Pressable accessibilityRole="button" disabled={running || activeProject === null}
          onPress={() => {
            if (activeProject === null) return;
            const result = assembleApprovedWriterShots(activeProject);
            setWriterMessage(result.ok
              ? `Placed ${productionRows.length} approved shots on the timeline in Writer order.`
              : result.reason);
          }} style={press([styles.approve, (running || activeProject === null) && styles.approveOff])}>
          <Text style={styles.approveText}>Assemble approved Writer cut</Text>
        </Pressable>
        <Text style={styles.footnote}>Assigning the world/style image and imported storyboard or character images is currently done in the desktop production board; mobile reads the same saved mapping and assembly rules. Batch image/video generation and signed-in browser automation remain desktop-only, so this screen never starts a hidden queue or silently charges a provider.</Text>
      </View>}
      {writerShots.length > 0 && <View>
        <Text style={styles.label}>Approved Writer shots — choose one to load, not generate</Text>
        {writerShots.map((shot) => <Pressable key={shot.id} accessibilityRole="button" disabled={running || redoing !== null || asking}
          style={press({ minHeight: MIN_TAP, padding: 10 })} onPress={() => {
            if (!supportedShotSeconds(model.id).includes(shot.durationSeconds)) {
              setWriterMessage(`This shot needs ${shot.durationSeconds}s; the model accepts ${supportedShotSeconds(model.id).join('/')}s. Choose a compatible model or revise the Writer shot.`);
              return;
            }
            setPlan(() => { setPrompt(shot.prompt); setTotalSeconds(shot.durationSeconds); setDescriptions({}); });
            setWriterMessage('Shot loaded, not generated. Review the prompt, references and spend confirmation before rendering.');
          }}><Text style={{ color: theme.text }}>{shot.label}</Text></Pressable>)}
        {!!writerMessage && <Text style={{ color: theme.textWeak }}>{writerMessage}</Text>}
      </View>}
      <Text style={styles.h1}>Plan a video</Text>
      <Text style={styles.sub}>Shot lengths and prices come from the same modules the desktop app uses.</Text>
      <Text style={styles.body}>Signed-in Google Flow video automation is desktop-only. Grok Imagine browser automation is desktop-only too. Login, CAPTCHA, verification, and account-limit states must be resolved on desktop; mobile continues to use supported official API-key routes.</Text>

      <Text style={styles.label}>Model</Text>
      <ModelSelect
        domain="video-generation"
        selectedId={modelId}
        connected={connected}
        onSelect={(next) => setPlan(() => setModelId(next.id))}
        onConnectionChange={refreshConnections}
      />

      <Text style={styles.label}>Input mode</Text>
      <View style={styles.row}>
        {INPUT_MODES.map((mode) => (
          <Chip key={mode.id} label={mode.label} selected={operation === mode.id}
            disabled={mode.id === 'motion_control' || !isVideoOperationImplemented(model.id, mode.id)}
            onPress={() => setPlan(() => {
              setOperation(mode.id);
              if (mode.id === 'reference_to_video' || mode.id === 'start_end') setContinuity(false);
            })} />
        ))}
      </View>
      <Text style={styles.body}>Motion Control remains visible here but runs only in the desktop app, where OpenScene can safely read project video files and reach your user-managed ComfyUI worker.</Text>
      {(operation === 'start_end' || operation === 'reference_to_video') && totalSeconds !== 8 && (
        <Text style={styles.warn}>Choose 8s for this manual advanced-input render. It runs as one reviewed shot.</Text>
      )}

      {(operation === 'image_to_video' || operation === 'start_end') && <View>
        <Text style={styles.label}>First frame</Text>
        <ReferenceRow value={firstFrame} empty="Required before generation." onPick={() => void pickReference('first')} onRemove={() => setFirstFrame(null)} />
      </View>}
      {operation === 'start_end' && <View>
        <Text style={styles.label}>Last frame</Text>
        <ReferenceRow value={lastFrame} empty="Required. Veo creates the movement between both frames." onPick={() => void pickReference('last')} onRemove={() => setLastFrame(null)} />
      </View>}
      {operation === 'reference_to_video' && <View>
        <Text style={styles.label}>Character / product references ({assetReferences.length}/3)</Text>
        {assetReferences.map((image, index) => <ReferenceRow key={`${image.displayName}-${index}`} value={image}
          empty="" onPick={() => undefined}
          onRemove={() => setAssetReferences((current) => current.filter((_, position) => position !== index))} />)}
        {assetReferences.length < 3 && <ReferenceRow value={null} empty="Add 1-3 reviewed images. Nothing is attached automatically."
          onPick={() => void pickReference('asset')} onRemove={() => undefined} />}
      </View>}

      <Text style={styles.label}>Length</Text>
      <View style={styles.row}>
        {LENGTHS.map((seconds) => (
          <Chip
            key={seconds}
            label={`${seconds}s`}
            selected={seconds === totalSeconds}
            onPress={() => setPlan(() => setTotalSeconds(seconds))}
          />
        ))}
      </View>

      <Text style={styles.label}>Aspect ratio</Text>
      <View style={styles.row}>
        {aspectRatioOptions.map((ratio) => (
          <Chip
            key={ratio}
            label={ratio}
            selected={ratio === effectiveAspectRatio}
            onPress={() => setPlan(() => setAspectRatio(ratio))}
          />
        ))}
      </View>

      {plan.shots.length > 1 && (
        <>
          <Text style={styles.label}>Continuity</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: continuity && continuityPossible }}
            disabled={!continuityPossible}
            onPress={() => setPlan(() => setContinuity((value) => !value))}
            style={press([styles.toggle, !continuityPossible && styles.toggleOff])}
          >
            <View style={[styles.box, continuity && continuityPossible && styles.boxOn]} />
            <Text style={styles.toggleText}>Start each shot from the last frame of the one before</Text>
          </Pressable>
          {!continuityPossible && (
            <Text style={styles.body}>
              {operation === 'start_end' || operation === 'reference_to_video'
                ? 'This advanced mode is one reviewed shot. Choose 8s; use First frame for a longer chained storyboard.'
                : supportsReferenceImage(model?.id ?? '')
                ? 'This build cannot read a frame out of a clip — rebuild the development client to chain shots.'
                : `${model?.providerLabel} cannot start from a supplied frame, so shots are generated independently.`}
            </Text>
          )}
        </>
      )}

      <Text style={styles.label}>Scenario · carried by every shot</Text>
      <TextInput
        ref={promptInput}
        onFocus={() => reveal(promptInput.current)}
        style={styles.input}
        value={prompt}
        onChangeText={(value) => setPlan(() => setPrompt(value))}
        placeholder="Describe the video…"
        placeholderTextColor={theme.textWeaker}
        multiline
        accessibilityLabel="Video prompt"
      />

      <Text style={styles.label}>
        {plan.shots.length} shot{plan.shots.length === 1 ? '' : 's'} · accepts{' '}
        {supportedShotSeconds(model.id).join('/')}s
      </Text>
      {plan.shots.map((shot) => {
        const take = takes[shot.index];
        const candidateAsset = take === undefined ? undefined : activeProject?.assets.find((asset) => asset.id === take.assetId);
        const revisions = take === undefined ? [] : revisionsOf(take.prompt);
        return (
          <View key={shot.index}>
            <View style={styles.shot}>
              <Text style={styles.shotIndex}>{String(shot.index).padStart(2, '0')}</Text>
              <Text style={styles.shotBody}>
                {shot.startSeconds}s → {shot.startSeconds + shot.durationSeconds}s
              </Text>
              <Text style={styles.shotLen}>{shot.durationSeconds}s</Text>
              <ShotStatus state={shotStates[shot.index - 1] ?? { kind: 'idle' }} />
            </View>

            {/* What happens in this shot, on top of the scenario. Empty means
                the scenario alone, which is what every shot used to get. */}
            <TextInput
              style={styles.shotInput}
              value={descriptions[shot.index] ?? ''}
              onChangeText={(value) => setDescriptions((current) => ({ ...current, [shot.index]: value }))}
              placeholder={`Shot ${shot.index} — what happens here (optional)`}
              placeholderTextColor={theme.textWeaker}
              multiline
              accessibilityLabel={`Description for shot ${shot.index}`}
            />

            {take !== undefined && (
              <View style={styles.takeRow}>
                <Text style={styles.takeLabel}>
                  {takeLabel(take.takeNumber)} · {take.decision}
                  {revisions.length > 0 ? ` · ${revisions.length} change${revisions.length === 1 ? '' : 's'}` : ''}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={running || redoing !== null}
                  onPress={() => {
                    setNote('');
                    setNoteFor(noteFor === shot.index ? null : shot.index);
                  }}
                  style={press([styles.redo, (running || redoing !== null) && styles.approveOff])}
                >
                  <Text style={styles.redoText}>{redoing === shot.index ? 'Redoing…' : 'Redo with a note'}</Text>
                </Pressable>
              </View>
            )}

            {take !== undefined && (
              <View style={styles.reviewCard}>
                <Text style={styles.label}>Continuity review</Text>
                {candidateAsset !== undefined && projectId !== null && <CandidateVideo key={candidateAsset.id} projectId={projectId} asset={candidateAsset} />}
                {CONTINUITY_REVIEW_FIELDS.map((field) => (
                  <View key={field}>
                    <Text style={styles.body}>{REVIEW_LABELS[field]}</Text>
                    <View style={styles.row}>
                      {REVIEW_VALUES.map((value) => <Chip key={value} label={value}
                        selected={take.continuityReview[field] === value}
                        onPress={() => reviewTake(shot.index, field, value)} />)}
                    </View>
                  </View>
                ))}
                <TextInput
                  style={styles.shotInput}
                  value={take.reviewNotes}
                  onChangeText={(value) => setTakes((current) => ({
                    ...current,
                    [shot.index]: { ...take, decision: 'pending', reviewNotes: value }
                  }))}
                  placeholder="Review notes; required if you accept a warning"
                  placeholderTextColor={theme.textWeaker}
                  multiline
                  accessibilityLabel={`Review notes for shot ${shot.index}`}
                />
                <View style={styles.row}>
                  <Pressable accessibilityRole="button" disabled={take.decision === 'approved'}
                    onPress={() => approveTake(shot.index)}
                    style={press([styles.approve, take.decision === 'approved' && styles.approveOff])}>
                    <Text style={styles.approveText}>{take.decision === 'approved' ? 'Approved on timeline' : 'Approve to timeline'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={take.decision === 'rejected'}
                    onPress={() => setTakes((current) => ({ ...current, [shot.index]: { ...take, decision: 'rejected' } }))}
                    style={press([styles.redo, take.decision === 'rejected' && styles.approveOff])}>
                    <Text style={styles.redoText}>Reject candidate</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {revisions.length > 0 && (
              <Text style={styles.body}>{revisions.map((revision, order) => `${order + 1}. ${revision}`).join('  ')}</Text>
            )}

            {noteFor === shot.index && (
              <View>
                <TextInput
                  style={styles.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="What to change — slower, no text on screen…"
                  placeholderTextColor={theme.textWeaker}
                  multiline
                  accessibilityLabel={`What to change about shot ${shot.index}`}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={note.trim().length === 0}
                  onPress={() => void redoShot(shot.index, note)}
                  style={press([styles.approve, note.trim().length === 0 && styles.approveOff])}
                >
                  <Text style={styles.approveText}>Generate this shot again</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {shotStates.map((state, index) =>
        state.kind === 'failed' ? (
          <Text key={`failed-${index}`} style={styles.warn}>
            Shot {index + 1}: {state.message}
          </Text>
        ) : null
      )}

      {plan.roundedFrom !== undefined && (
        <Text style={styles.warn}>
          {plan.roundedFrom}s is not reachable from this model&apos;s shot lengths — the plan runs{' '}
          {plan.totalSeconds}s.
        </Text>
      )}

      <Text style={styles.label}>Repeat in every shot prompt</Text>
      <Text style={styles.body}>
        {CONTINUITY_KEYS.join(' · ')} — each shot is rendered blind, so anything that must stay the same has to be
        restated rather than referenced.
      </Text>

      <View style={styles.runCard}>
        <Pressable
          accessibilityRole="button"
          disabled={!canGenerate}
          onPress={start}
          style={press([styles.approve, !canGenerate && styles.approveOff])}
        >
          <Text style={styles.approveText}>
            {running ? 'Generating…' : `Generate ${plan.shots.length} shot${plan.shots.length === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
        {projectId === null && <Text style={styles.footnote}>Open a project first — generated shots are saved into it.</Text>}
        {projectId !== null && connected[model?.providerId ?? ''] !== true && (
          <Text style={styles.footnote}>{model?.providerLabel} is not connected. Add its key with ＋ above.</Text>
        )}
        {shotStates.some((state) => state.kind === 'done') && (
          <Text style={styles.footnote}>
            Finished candidates are saved in the project library. Review each one above; only an approved take changes the timeline.
          </Text>
        )}
        <Text style={styles.footnote}>If the phone closes during a provider request, it is never submitted again automatically. Only a returned result saved into the project is treated as completed.</Text>
      </View>

      <SpendPrompt
        feature="video-generation"
        headline={runLine}
        visible={asking}
        onDecide={decide}
        onDismiss={() => setAsking(false)}
      />
    </FormScreen>
  );
}

function ShotStatus({ state }: { readonly state: ShotState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={theme.accent} />
        <Text style={styles.statusText}>{state.stage}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.statusText, state.kind === 'done' ? styles.statusDone : styles.statusFailed]}>
      {state.kind === 'done' ? 'saved' : 'failed'}
    </Text>
  );
}

function ReferenceRow({ value, empty, onPick, onRemove }: {
  readonly value: PickedReference | null;
  readonly empty: string;
  readonly onPick: () => void;
  readonly onRemove: () => void;
}) {
  return <View style={styles.referenceRow}>
    {value !== null && <Image style={styles.referencePreview}
      source={{ uri: `data:${value.mimeType};base64,${value.base64}` }}
      accessibilityLabel={`Reference image ${value.displayName}`} />}
    <Text style={styles.referenceName}>{value?.displayName ?? empty}</Text>
    <Pressable accessibilityRole="button" onPress={value === null ? onPick : onRemove} style={press(styles.referenceButton)}>
      <Text style={styles.redoText}>{value === null ? 'Choose image' : 'Remove'}</Text>
    </Pressable>
  </View>;
}

function CandidateVideo({ projectId, asset }: { readonly projectId: string; readonly asset: MobileAsset }) {
  const player = useVideoPlayer(assetUri(projectId, asset));
  return <VideoView player={player} style={styles.candidateVideo} contentFit="contain" nativeControls />;
}

function Chip({ label, selected, disabled = false, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={press([styles.chip, selected && styles.chipOn, disabled && styles.toggleOff])}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  body: { color: theme.textWeak, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  shot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.line },
  shotIndex: { color: theme.mint, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  shotBody: { color: theme.text, fontSize: 14, flex: 1, fontVariant: ['tabular-nums'] },
  shotLen: { color: theme.textWeak, fontSize: 13, fontVariant: ['tabular-nums'] },
  warn: { color: theme.warn, fontSize: 13, lineHeight: 19, marginTop: 6 },
  runCard: { marginTop: 24, padding: 16, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 4 },
  footnote: { color: theme.textWeaker, fontSize: 12, lineHeight: 17, marginTop: 8 },
  // The whole row is the switch, so the target is the sentence rather than the
  // 18pt box beside it.
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TAP, paddingVertical: 4 },
  toggleOff: { opacity: 0.45 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.line },
  boxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  toggleText: { flex: 1, color: theme.text, fontSize: 13, lineHeight: 18 },
  input: { minHeight: 96, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { color: theme.textWeak, fontSize: 12, fontWeight: '600' },
  statusDone: { color: theme.mint },
  statusFailed: { color: theme.danger },
  approveOff: { opacity: 0.35 },
  shotInput: {
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 14,
    textAlignVertical: 'top'
  },
  takeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  reviewCard: { marginTop: 10, padding: 12, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  candidateVideo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000' },
  takeLabel: { flex: 1, color: theme.textWeak, fontSize: 13 },
  redo: {
    justifyContent: 'center',
    minHeight: MIN_TAP,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line
  },
  redoText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  approve: { marginTop: 14, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  approveText: { color: theme.bg, fontSize: 15, fontWeight: '700' },
  referenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TAP, borderBottomWidth: 1, borderBottomColor: theme.line },
  referenceName: { flex: 1, color: theme.textWeak, fontSize: 13 },
  referencePreview: { width: 56, height: 56, borderRadius: 8, resizeMode: 'cover' },
  referenceButton: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12 }
});
