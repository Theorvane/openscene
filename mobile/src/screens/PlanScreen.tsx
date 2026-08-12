import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { planVideoStoryboard, supportedShotSeconds, CONTINUITY_KEYS } from '@openvideo/shared/videoStoryboardPlan';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { ModelSelect } from '../components/ModelSelect';
import { supportsReferenceImage, type VideoAspectRatio, type VideoProgressStage } from '@openvideo/shared/videoGeneration';
import { isFrameExtractionAvailable } from '../../modules/video-export';
import { readProviderConnections } from '../lib/mediaProviders';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { generateShot } from '../lib/videoGeneration';
import { appendAssetToTimeline, readProject } from '../lib/projectStore';
import { SpendPrompt } from '../components/SpendPrompt';
import { FormScreen } from '../components/FormScreen';
import { useRevealOnFocus } from '../components/KeyboardAwareScroll';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

const RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1'];

/** Per-shot state, so a failure names the shot that failed. */
type ShotState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly stage: VideoProgressStage }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly message: string };

const LENGTHS = [8, 16, 30, 45, 60] as const;

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
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => entry.available)?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [shotStates, setShotStates] = useState<readonly ShotState[]>([]);
  const [running, setRunning] = useState(false);
  const [continuity, setContinuity] = useState(true);
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
  const plan = useMemo(
    () => planVideoStoryboard({ totalSeconds, providerId: model.providerId }),
    [totalSeconds, model.providerId]
  );

  // Changing anything about the plan clears the last run's results. Leaving them
  // on screen next to a different plan and a different price would misreport
  // what was actually generated.
  const setPlan = (next: () => void): void => {
    setShotStates([]);
    next();
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

      const result = await generateShot({
        projectId,
        modelId: model.id,
        // Each shot is rendered blind, so the continuity keys are restated in
        // every prompt rather than referenced across shots.
        prompt: `${prompt.trim()} — shot ${shot.index} of ${plan.shots.length}, ${shot.durationSeconds}s. ${
          carriedFrame === undefined
            ? `Keep consistent: ${CONTINUITY_KEYS.join(', ')}.`
            : // With a start frame the model can see the continuity keys rather
              // than being told them, so the prompt asks it to carry on instead
              // of re-describing a scene it is already looking at.
              'Continue directly from the supplied first frame, keeping the same subject, wardrobe, location and lighting.'
        }`,
        aspectRatio,
        durationSeconds: shot.durationSeconds,
        ...(carriedFrame === undefined ? {} : { referenceImage: carriedFrame }),
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
      mark(appendAssetToTimeline(project, result.asset) === null
        ? { kind: 'failed', message: 'The clip was generated but no video track would take it.' }
        : { kind: 'done' });
    }

    setRunning(false);
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
  const continuityPossible = isFrameExtractionAvailable && supportsReferenceImage(model?.providerId ?? '');

  const runLine = `${plan.shots.length} shot${plan.shots.length === 1 ? '' : 's'} · ${plan.totalSeconds}s`;
  const canGenerate =
    projectId !== null && !running && prompt.trim().length > 0 && connected[model?.providerId ?? ''] === true;

  return (
    <FormScreen topInset={topInset} keyboardOffset={keyboardOffset}>
      <Text style={styles.h1}>Plan a video</Text>
      <Text style={styles.sub}>Shot lengths and prices come from the same modules the desktop app uses.</Text>

      <Text style={styles.label}>Model</Text>
      <ModelSelect
        domain="video-generation"
        selectedId={modelId}
        connected={connected}
        onSelect={(next) => setPlan(() => setModelId(next.id))}
        onConnectionChange={refreshConnections}
      />

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
        {RATIOS.map((ratio) => (
          <Chip key={ratio} label={ratio} selected={ratio === aspectRatio} onPress={() => setPlan(() => setAspectRatio(ratio))} />
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
              {supportsReferenceImage(model?.providerId ?? '')
                ? 'This build cannot read a frame out of a clip — rebuild the development client to chain shots.'
                : `${model?.providerLabel} cannot start from a supplied frame, so shots are generated independently.`}
            </Text>
          )}
        </>
      )}

      <Text style={styles.label}>Prompt · used for every shot</Text>
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
        {supportedShotSeconds(model.providerId).join('/')}s
      </Text>
      {plan.shots.map((shot) => (
        <View key={shot.index} style={styles.shot}>
          <Text style={styles.shotIndex}>{String(shot.index).padStart(2, '0')}</Text>
          <Text style={styles.shotBody}>
            {shot.startSeconds}s → {shot.startSeconds + shot.durationSeconds}s
          </Text>
          <Text style={styles.shotLen}>{shot.durationSeconds}s</Text>
          <ShotStatus state={shotStates[shot.index - 1] ?? { kind: 'idle' }} />
        </View>
      ))}
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
            Finished shots are appended to the project&apos;s video track — open Edit to see them.
          </Text>
        )}
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

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={press([styles.chip, selected && styles.chipOn])}
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
  approve: { marginTop: 14, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  approveText: { color: theme.bg, fontSize: 15, fontWeight: '700' }
});
