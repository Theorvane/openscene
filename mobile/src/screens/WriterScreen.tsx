import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getDomainModels, isDomainModelAvailableOnRuntime } from '@openvideo/shared/aiDomainModels';
import { requestWriter } from '@openvideo/shared/writerGeneration';
import { getLlmProvider } from '@openvideo/shared/llmProviders';
import {
  WRITER_MODEL_IDS,
  applyWriterDraft,
  writerDraftDurationSeconds,
  type WriterDraft,
  type WriterMode,
  type WriterRequest
} from '@openvideo/shared/writerWorkflow';
import { FormScreen } from '../components/FormScreen';
import { ModelSelect } from '../components/ModelSelect';
import { useRevealOnFocus } from '../components/KeyboardAwareScroll';
import { readSlot } from '../lib/credentials';
import { readProviderConnections } from '../lib/mediaProviders';
import { readProject, writeProject } from '../lib/projectStore';
import { MIN_TAP, press } from '../lib/touch';
import { theme } from '../lib/theme';

const MODES: readonly { id: WriterMode; label: string }[] = [
  { id: 'idea_to_script', label: 'Idea' },
  { id: 'content_to_script', label: 'Content' },
  { id: 'rewrite', label: 'Rewrite' }
];

export function WriterScreen({
  topInset,
  keyboardOffset,
  projectId,
  connectionsVersion
}: {
  readonly topInset: number;
  readonly keyboardOffset: number;
  readonly projectId: string | null;
  readonly connectionsVersion: number;
}) {
  const catalog = getDomainModels('writer');
  const [modelId, setModelId] = useState(() => catalog[0]?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [mode, setMode] = useState<WriterMode>('idea_to_script');
  const [sourceText, setSourceText] = useState('');
  const [language, setLanguage] = useState('Vietnamese');
  const [audience, setAudience] = useState('General audience');
  const [tone, setTone] = useState('Cinematic and engaging');
  const [durationText, setDurationText] = useState('60');
  const [parentScriptId, setParentScriptId] = useState('');
  const [preview, setPreview] = useState<{ draft: WriterDraft; request: WriterRequest } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sourceInput = useRef<TextInput>(null);
  const reveal = useRevealOnFocus();

  const refreshConnections = useCallback((): void => {
    void readProviderConnections().then(setConnected);
  }, []);
  useEffect(refreshConnections, [connectionsVersion, refreshConnections]);

  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const project = projectId === null ? null : readProject(projectId);
  const scripts = useMemo(
    () => (project?.ai.scripts ?? []).filter((script) => script.status !== 'superseded').slice().reverse(),
    [project?.ai.scripts]
  );
  const parent = project?.ai.scripts.find((script) => script.id === parentScriptId);
  const targetDurationSeconds = Number(durationText);
  const modelAvailable = model !== undefined && isDomainModelAvailableOnRuntime(model, 'mobile');

  const generate = async (): Promise<void> => {
    if (model === undefined || !(WRITER_MODEL_IDS as readonly string[]).includes(model.id)) return;
    if (!modelAvailable) {
      setMessage(model.unavailableReason ?? 'This Writer model is not available on mobile.');
      return;
    }
    if (mode === 'rewrite' && parent === undefined) {
      setMessage('Choose a script version to rewrite.');
      return;
    }
    const request: WriterRequest = {
      mode,
      sourceText: sourceText.trim(),
      language: language.trim(),
      audience: audience.trim(),
      tone: tone.trim(),
      targetDurationSeconds,
      ...(mode === 'rewrite' && parent !== undefined
        ? { parentScriptId: parent.id, currentScreenplay: parent.screenplay }
        : {})
    };
    const provider = getLlmProvider(model.providerId);
    const apiKey = provider?.credentialKey === undefined ? null : await readSlot(provider.credentialKey);
    if (apiKey === null) {
      setMessage(`${model.providerLabel} is not connected. Add its API key in Settings.`);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const draft = await requestWriter({
        apiKey,
        modelId: model.id as (typeof WRITER_MODEL_IDS)[number],
        request
      });
      setPreview({ draft, request });
      setMessage('Draft ready. Review it before saving.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${model.providerLabel} Writer failed.`);
    } finally {
      setBusy(false);
    }
  };

  const save = (): void => {
    if (preview === null || project === null) return;
    const applied = applyWriterDraft({
      document: project.ai,
      request: preview.request,
      draft: preview.draft,
      createdAt: new Date().toISOString(),
      idPrefix: `writer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    });
    if (!applied.ok) {
      setMessage(applied.message);
      return;
    }
    try {
      writeProject({ ...project, ai: applied.document });
      setPreview(null);
      setMessage(`Saved “${preview.draft.title}” to this project.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Writer draft could not be saved.');
    }
  };

  const canGenerate = !busy && project !== null && model !== undefined && modelAvailable && connected[model.providerId] === true && sourceText.trim().length > 0 &&
    language.trim().length > 0 && audience.trim().length > 0 && tone.trim().length > 0 &&
    Number.isSafeInteger(targetDurationSeconds) && targetDurationSeconds >= 4 && targetDurationSeconds <= 7_200 &&
    (mode !== 'rewrite' || parent !== undefined);

  return (
    <FormScreen topInset={topInset} keyboardOffset={keyboardOffset}>
      <Text style={styles.h1}>Writer & Storyboard</Text>
      <Text style={styles.sub}>The selected Writer model creates a structured draft. Nothing changes until you review and save it.</Text>

      <Text style={styles.label}>Model</Text>
      <ModelSelect
        domain="writer"
        selectedId={modelId}
        connected={connected}
        onSelect={(next) => { setModelId(next.id); setPreview(null); }}
        onConnectionChange={refreshConnections}
      />

      <Text style={styles.label}>Task</Text>
      <View style={styles.row}>
        {MODES.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === entry.id }}
            onPress={() => { setMode(entry.id); setPreview(null); }}
            style={press([styles.chip, mode === entry.id && styles.chipOn])}
          >
            <Text style={[styles.chipText, mode === entry.id && styles.chipTextOn]}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'rewrite' && (
        <>
          <Text style={styles.label}>Script version</Text>
          {scripts.length === 0 ? <Text style={styles.note}>Save a first script before using Rewrite.</Text> : scripts.map((script) => (
            <Pressable
              key={script.id}
              accessibilityRole="button"
              accessibilityState={{ selected: parentScriptId === script.id }}
              onPress={() => { setParentScriptId(script.id); setPreview(null); }}
              style={press([styles.script, parentScriptId === script.id && styles.scriptOn])}
            >
              <Text style={styles.scriptTitle}>{script.title}</Text>
              <Text style={styles.note}>{script.sourceKind} · {script.status}</Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={styles.label}>{mode === 'rewrite' ? 'Rewrite instructions' : mode === 'content_to_script' ? 'Source content' : 'Idea'}</Text>
      <TextInput
        ref={sourceInput}
        onFocus={() => reveal(sourceInput.current)}
        multiline
        textAlignVertical="top"
        value={sourceText}
        onChangeText={(value) => { setSourceText(value); setPreview(null); }}
        placeholder="Describe the video, paste content, or explain the changes…"
        placeholderTextColor={theme.textWeaker}
        style={[styles.input, styles.source]}
      />
      <View style={styles.two}>
        <View style={styles.flex}><Text style={styles.label}>Language</Text><TextInput value={language} onChangeText={setLanguage} style={styles.input} /></View>
        <View style={styles.flex}><Text style={styles.label}>Seconds</Text><TextInput value={durationText} onChangeText={setDurationText} keyboardType="number-pad" style={styles.input} /></View>
      </View>
      <Text style={styles.label}>Audience</Text>
      <TextInput value={audience} onChangeText={setAudience} style={styles.input} />
      <Text style={styles.label}>Tone</Text>
      <TextInput value={tone} onChangeText={setTone} style={styles.input} />
      <Text style={styles.note}>Generate is an explicit request to the selected provider and may incur text-generation charges.</Text>
      {!modelAvailable && model?.unavailableReason !== undefined && <Text style={styles.message}>{model.unavailableReason}</Text>}

      <Pressable accessibilityRole="button" disabled={!canGenerate} onPress={() => void generate()} style={press([styles.primary, !canGenerate && styles.off])}>
        {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.primaryText}>Generate draft</Text>}
      </Pressable>
      {message.length > 0 && <Text style={styles.message}>{message}</Text>}

      {preview !== null && (
        <View style={styles.preview}>
          <Text style={styles.previewTitle}>{preview.draft.title}</Text>
          <Text style={styles.note}>{preview.draft.scenes.length} scenes · {preview.draft.scenes.reduce((n, scene) => n + scene.shots.length, 0)} shots · {writerDraftDurationSeconds(preview.draft)}s</Text>
          <Text style={styles.screenplay}>{preview.draft.screenplay}</Text>
          {preview.draft.scenes.map((scene, index) => (
            <View key={`${index}-${scene.title}`} style={styles.scene}>
              <Text style={styles.scriptTitle}>{index + 1}. {scene.title}</Text>
              <Text style={styles.note}>{scene.setting}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''} · {scene.shots.length} shots</Text>
              <Text style={styles.sceneText}>{scene.objective}</Text>
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => setPreview(null)} style={press(styles.secondary)}><Text style={styles.secondaryText}>Discard</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={save} style={press(styles.primary)}><Text style={styles.primaryText}>Save to project</Text></Pressable>
          </View>
        </View>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  h1: { color: theme.text, fontSize: 25, fontWeight: '700', marginBottom: 2 },
  sub: { color: theme.textWeak, lineHeight: 20, marginBottom: 12 },
  label: { color: theme.textWeak, fontSize: 12, fontWeight: '700', marginTop: 10, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 10, backgroundColor: theme.surface },
  chipOn: { borderColor: theme.accent, backgroundColor: 'rgba(166, 144, 255, 0.14)' },
  chipText: { color: theme.textWeak, fontWeight: '600' },
  chipTextOn: { color: theme.accent },
  input: { minHeight: MIN_TAP, borderWidth: 1, borderColor: theme.line, borderRadius: 10, backgroundColor: theme.surface, color: theme.text, paddingHorizontal: 12, paddingVertical: 10 },
  source: { minHeight: 150 },
  two: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  note: { color: theme.textWeaker, fontSize: 12, lineHeight: 17 },
  primary: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: theme.accent },
  primaryText: { color: theme.bg, fontWeight: '800' },
  off: { opacity: 0.42 },
  message: { color: theme.textWeak, lineHeight: 19, marginTop: 8 },
  script: { padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 10, backgroundColor: theme.surface, gap: 3 },
  scriptOn: { borderColor: theme.accent },
  scriptTitle: { color: theme.text, fontWeight: '700' },
  preview: { marginTop: 18, gap: 10, padding: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.surface },
  previewTitle: { color: theme.text, fontSize: 19, fontWeight: '800' },
  screenplay: { color: theme.text, lineHeight: 21 },
  scene: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.line },
  sceneText: { color: theme.textWeak, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  secondary: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: theme.line, borderRadius: 10 },
  secondaryText: { color: theme.text, fontWeight: '700' }
});
