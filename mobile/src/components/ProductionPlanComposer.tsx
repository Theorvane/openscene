import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import { createUseProductionPlan } from '@openvideo/shared/useProductionPlan';
import { pipelineBaseRequest, pipelineMatchesBrief } from '@openvideo/shared/writerPipeline';
import { getDomainModels, isDomainModelAvailableOnRuntime } from '@openvideo/shared/aiDomainModels';
import { getLlmProvider } from '@openvideo/shared/llmProviders';
import { requestWriter } from '@openvideo/shared/writerGeneration';
import type { WriterModelId, WriterRequest } from '@openvideo/shared/writerWorkflow';
import { readSlot } from '../lib/credentials';
import { readProviderConnections } from '../lib/mediaProviders';
import { ModelSelect } from './ModelSelect';
import { nextProductionCheckpoint } from '@openvideo/shared/productionPlan';
import { WRITER_STAGES, WRITER_STAGE_LABELS, WRITER_STAGE_CHECKLISTS } from '@openvideo/shared/writerStages';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';
const useProductionPlan = createUseProductionPlan({ useEffect, useRef, useState });

export function ProductionPlanComposer({ document, onSave, disabled, connectionsVersion }: {
  document: AiProjectDocument; onSave: (document: AiProjectDocument) => Promise<boolean>; disabled: boolean; connectionsVersion: number;
}) {
  const base = pipelineBaseRequest(document.writerPipeline);
  const [brief, setBrief] = useState(base?.sourceText ?? '');
  const [seconds, setSeconds] = useState(String(base?.targetDurationSeconds ?? 600));
  const [showCustomLength, setShowCustomLength] = useState(![300, 600, 900].includes(base?.targetDurationSeconds ?? 600));
  const [showPlanOptions, setShowPlanOptions] = useState(false);
  const [language, setLanguage] = useState(base?.language ?? 'Korean');
  const [modelId, setModelId] = useState(getDomainModels('writer')[0]?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  useEffect(() => { let current = true; void readProviderConnections().then(result => { if (current) setConnected(result); }); return () => { current = false; }; }, [connectionsVersion]);
  const model = getDomainModels('writer').find(item => item.id === modelId);
  const flow = useProductionPlan(document, onSave);
  const [expanded, setExpanded] = useState<string | null>('screenplay');
  const request: WriterRequest = { ...(base ?? { mode: 'idea_to_script', audience: 'General audience', tone: 'Cinematic and engaging', shotDurationSeconds: 5 as const }), sourceText: brief.trim(), targetDurationSeconds: Number(seconds), language: language.trim() };
  const busy = disabled || flow.busy;
  const valid = !!request.sourceText && !!request.language && Number.isSafeInteger(request.targetDurationSeconds) && request.targetDurationSeconds >= (request.shotDurationSeconds === 5 ? 300 : 4) && request.targetDurationSeconds <= (request.shotDurationSeconds === 5 ? 900 : 7200) && (request.shotDurationSeconds !== 5 || request.targetDurationSeconds % 5 === 0);
  const matches = pipelineMatchesBrief(flow.proposal, request);
  const applied = !!document.writerPipeline?.appliedScriptId;
  const checkpoint = nextProductionCheckpoint(flow.proposal);
  useEffect(() => { if (checkpoint) setExpanded(checkpoint); }, [checkpoint]);
  const action = (label: string, callback: () => void, off = false) => <Pressable accessibilityRole="button" disabled={off} onPress={callback} style={press([styles.button, off && { opacity: .5 }])}><Text style={styles.text}>{label}</Text></Pressable>;
  return <View style={styles.card}>
    <Text style={styles.title}>{applied ? 'Screenplay and scene plan' : flow.proposal ? 'Review your film plan' : 'Start your film here'}</Text>
    <Text style={styles.text}>Describe your story. Approve its plan, then make each scene from five-second shots.</Text>
    <TextInput accessibilityLabel="Production brief" placeholder="Describe a 5–15 minute story, its characters, scene changes and ending…" placeholderTextColor={theme.textWeak} multiline value={brief} onChangeText={setBrief} editable={!busy} style={[styles.input, { minHeight: 110 }]} />
    <Text style={styles.text}>Film length</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{[300, 600, 900].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: seconds === String(value) && !showCustomLength }} disabled={busy} onPress={() => { setSeconds(String(value)); setShowCustomLength(false); }} style={press([styles.lengthChoice, seconds === String(value) && !showCustomLength && styles.lengthChoiceActive])}><Text style={styles.text}>{value / 60} min</Text></Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => setShowCustomLength(true)} style={press(styles.lengthChoice)}><Text style={styles.text}>Other</Text></Pressable></View>
    {showCustomLength && <TextInput accessibilityLabel="Custom film length in seconds" placeholder="300–900 seconds, in steps of 5" placeholderTextColor={theme.textWeak} value={seconds} onChangeText={setSeconds} keyboardType="number-pad" editable={!busy} style={styles.input} />}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPlanOptions }} onPress={() => setShowPlanOptions(value => !value)} style={press(styles.lengthChoice)}><Text style={styles.text}>{showPlanOptions ? 'Hide' : 'Show'} language and writing model</Text></Pressable>
    {(showPlanOptions || !connected[model?.providerId ?? '']) && <>
      <Text style={styles.text}>Dialogue language</Text><TextInput accessibilityLabel="Dialogue language" value={language} onChangeText={setLanguage} editable={!busy} style={styles.input} />
      <ModelSelect domain="writer" selectedId={modelId} connected={connected} onSelect={item => setModelId(item.id)} onConnectionChange={() => { void readProviderConnections().then(setConnected); }} />
    </>}
    {action(flow.busy ? 'Working…' : flow.proposal ? 'Revise screenplay and scene plan' : 'Create screenplay and scene plan', () => {
      if (!model) return;
      Alert.alert('Generate production plan?', 'Text-model charges may apply. This replaces the planning draft, not existing media. No video generation starts.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Propose plan', onPress: () => {
        void flow.generate(request, model.id, async input => {
          const provider = getLlmProvider(model.providerId);
          const apiKey = provider?.credentialKey ? await readSlot(provider.credentialKey) : null;
          if (!apiKey) throw new Error('Connect the writing provider in Settings.');
          return requestWriter({ apiKey, modelId: model.id as WriterModelId, request: input });
        });
      } }]);
    }, busy || !valid || !model || !isDomainModelAvailableOnRuntime(model, 'mobile') || !connected[model.providerId])}
    {!request.sourceText && <Text style={styles.text}>Start by writing a story brief. This step does not generate video.</Text>}
    {!connected[model?.providerId ?? ''] && <Text style={styles.text}>Connect the selected writing provider in Settings to create a plan.</Text>}
    {flow.proposal && <>
      <Text style={styles.text}>{WRITER_STAGES.map(stage => `${flow.proposal!.artifacts.some(item => item.stage === stage && item.approved) ? '✓' : checkpoint === stage ? '→' : '○'} ${WRITER_STAGE_LABELS[stage]}`).join('\n')}</Text>
      {flow.proposal.artifacts.map(artifact => <View key={artifact.stage}>{action(`${WRITER_STAGE_LABELS[artifact.stage]} · ${artifact.approved ? 'Approved' : 'Review required'}`, () => setExpanded(expanded === artifact.stage ? null : artifact.stage))}{expanded === artifact.stage && <><Text selectable style={styles.text}>{artifact.content}</Text><Text style={styles.text}>{WRITER_STAGE_CHECKLISTS[artifact.stage].join('\n')}</Text></>}</View>)}
      {!matches && <Text style={styles.text}>Brief changed. Generate a revised plan before approval.</Text>}
      {flow.unsaved && action('Retry saving proposal', () => Alert.alert('Replace planning draft?', 'Save the retained proposal over the current draft?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: () => { void flow.saveDraft(); } }]), busy)}
      {action(applied ? 'Plan approved' : checkpoint ? `Approve ${WRITER_STAGE_LABELS[checkpoint]}` : 'No checkpoint to approve', () => {
        if (!checkpoint) return;
        Alert.alert(`Approve ${WRITER_STAGE_LABELS[checkpoint]}?`, checkpoint === 'prompts' ? 'Prepare production shots. Media generation still needs cost approval.' : 'Approve this checkpoint only, then review the next stage.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Approve checkpoint', onPress: () => { void flow.approve(request, checkpoint); } }]);
      }, busy || !matches || applied || flow.unsaved || !checkpoint)}
    </>}
    {!!flow.message && <Text accessibilityRole="alert" style={styles.text}>{flow.message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: 10, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 12 },
  title: { color: theme.text, fontSize: 20, fontWeight: '600' }, text: { color: theme.text, fontSize: 13 },
  input: { color: theme.text, borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: 10, minHeight: MIN_TAP },
  button: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 10, minHeight: MIN_TAP, justifyContent: 'center' },
  lengthChoice: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, paddingHorizontal: 12, minHeight: MIN_TAP, justifyContent: 'center' },
  lengthChoiceActive: { borderColor: theme.accent, backgroundColor: theme.surface }
});
