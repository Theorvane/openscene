import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import { approveNextSequentialScene, buildNextSequentialSceneRequest, discardNextSequentialScene, proposeNextSequentialScene } from '@openvideo/shared/sequentialProduction';
import { parseWriterPromptText } from '@openvideo/shared/writerPipeline';
import { getDomainModels, isDomainModelAvailableOnRuntime } from '@openvideo/shared/aiDomainModels';
import { getLlmProvider } from '@openvideo/shared/llmProviders';
import { requestWriter } from '@openvideo/shared/writerGeneration';
import type { WriterModelId } from '@openvideo/shared/writerWorkflow';
import { readSlot } from '../lib/credentials';
import { readProviderConnections } from '../lib/mediaProviders';
import { ModelSelect } from './ModelSelect';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

export function NextSceneComposer({ document, onSave, disabled, connectionsVersion }: {
  document: AiProjectDocument;
  onSave: (next: AiProjectDocument) => Promise<boolean>;
  disabled: boolean;
  connectionsVersion: number;
}) {
  const [brief, setBrief] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [modelId, setModelId] = useState(getDomainModels('writer')[0]?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unsaved, setUnsaved] = useState<AiProjectDocument | null>(null);
  useEffect(() => { let live = true; void readProviderConnections().then(value => { if (live) setConnected(value); }); return () => { live = false; }; }, [connectionsVersion]);
  const model = getDomainModels('writer').find(item => item.id === modelId);
  const pending = document.pendingSequentialScene;
  const draft = pending ? parseWriterPromptText(pending.draftJson) : null;
  const count = document.scenes.filter(item => item.scriptVersionId === document.writerPipeline?.appliedScriptId).length;
  const action = (label: string, onPress: () => void, blocked = false) => <Pressable accessibilityRole="button" disabled={blocked || busy || disabled} onPress={onPress} style={press([styles.button, (blocked || busy || disabled) && { opacity: .5 }])}><Text style={styles.text}>{label}</Text></Pressable>;
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await job(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update the scene plan.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Scene {count} complete. What happens next?</Text>
    <Text style={styles.text}>Plan just the next scene. Approve its five-second shots before video generation. Existing character identities and visual style stay locked. You can also assemble now.</Text>
    {!pending && <>
      <TextInput accessibilityLabel="Next scene brief" multiline placeholder="Describe what changes in the next scene…" placeholderTextColor={theme.textWeak} value={brief} onChangeText={setBrief} editable={!busy && !disabled} style={[styles.input, { minHeight: 100 }]} />
      <Text style={styles.text}>Scene length</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[15, 30, 60, 120, 180].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: seconds === value }} onPress={() => setSeconds(value)} style={press([styles.choice, seconds === value && { borderColor: theme.accent }])}><Text style={styles.text}>{value < 60 ? value + ' sec' : value / 60 + ' min'}</Text></Pressable>)}</View>
      <ModelSelect domain="writer" selectedId={modelId} connected={connected} onSelect={item => setModelId(item.id)} onConnectionChange={() => { void readProviderConnections().then(setConnected); }} />
      {action('Plan scene ' + (count + 1), () => {
        if (!model) return;
        Alert.alert('Plan next scene?', 'Text-model charges may apply. Video generation starts only after separate approval.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Plan scene', onPress: () => {
          void run(async () => {
            const request = buildNextSequentialSceneRequest(document, brief, seconds);
            const provider = getLlmProvider(model.providerId);
            const apiKey = provider?.credentialKey ? await readSlot(provider.credentialKey) : null;
            if (!apiKey) throw new Error('Connect the writing provider in Settings.');
            const draft = await requestWriter({ apiKey, modelId: model.id as WriterModelId, request });
            const next = proposeNextSequentialScene(document, request, draft, model.id);
            setUnsaved(next);
            if (!await onSave(next)) throw new Error('Proposal generated but not saved. Retry saving below.');
            setUnsaved(null);
            setMessage('Scene proposal saved. Review every shot before approval.');
          });
        } }]);
      }, !brief.trim() || !model || !isDomainModelAvailableOnRuntime(model, 'mobile') || !connected[model.providerId])}
    </>}
    {unsaved && action('Retry saving proposed scene', () => { void run(async () => { if (!await onSave(unsaved)) throw new Error('Could not save the proposal.'); setUnsaved(null); }); })}
    {pending && <>
      <Text style={styles.title}>Review scene {count + 1}: {draft?.scenes[0]?.title ?? 'Invalid proposal'}</Text>
      <Text selectable style={styles.text}>{draft?.screenplay}</Text>
      {draft?.scenes[0]?.shots.map((shot, index) => <View key={index} style={styles.shot}><Text style={styles.text}>Shot {index + 1} · 5 sec</Text><Text selectable style={styles.text}>{shot.action}</Text></View>)}
      {action('Approve and add scene', () => Alert.alert('Add this scene?', 'Earlier approved takes will stay attached to their shots.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Add scene', onPress: () => {
        void run(async () => {
          const next = approveNextSequentialScene(document, new Date().toISOString(), 'scene-' + Date.now().toString(36));
          if (!await onSave(next)) throw new Error('Could not save the approved scene.');
          setBrief('');
          setMessage('Scene added. Approve it before video generation.');
        });
      } }]), !draft)}
      {action('Discard proposal', () => Alert.alert('Discard next-scene proposal?', 'Existing scenes and takes stay saved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Discard', onPress: () => {
        void run(async () => { if (!await onSave(discardNextSequentialScene(document))) throw new Error('Could not discard proposal.'); });
      } }]))}
    </>}
    {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: 10, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '700' },
  text: { color: theme.text, fontSize: 13 },
  input: { color: theme.text, borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: 10, minHeight: MIN_TAP },
  button: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 12, minHeight: MIN_TAP, justifyContent: 'center' },
  choice: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: 10, minHeight: MIN_TAP, justifyContent: 'center' },
  shot: { borderTopWidth: 1, borderColor: theme.line, paddingTop: 8, gap: 4 }
});
