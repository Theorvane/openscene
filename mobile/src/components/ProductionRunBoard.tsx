import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CONTINUITY_REVIEW_FIELDS } from '@openvideo/shared/aiProjectDomain';
import { approvedWriterShots } from '@openvideo/shared/writerPipeline';
import { productionTextBatch } from '@openvideo/shared/productionPlan';
import { createProductionQueueControl } from '@openvideo/shared/productionQueueControl';
import { addGenerationCandidate, updateGenerationCandidate, setCandidateContinuity, decideGenerationCandidate, type GenerationReviewResult } from '@openvideo/shared/generationReview';
import { estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { generateShot } from '../lib/videoGeneration';
import { readProject, writeProject, saveGeneratedVideoCandidate, assembleApprovedWriterShots, assetUri } from '../lib/projectStore';
import { useSpendPermissions } from '../lib/permissions';
import type { VideoAspectRatio } from '@openvideo/shared/videoGeneration';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

function TakePreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls style={{ height: 180, width: '100%' }} />;
}
export function ProductionRunBoard({ projectId, model, aspectRatio, disabled, connected, onBusy, active }: {
  projectId: string; model: { id: string; label: string; providerId: string }; aspectRatio: VideoAspectRatio;
  disabled: boolean; connected: boolean; onBusy: (busy: boolean) => void; active: boolean;
}) {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const lock = useRef(false);
  const queueControl = useRef(createProductionQueueControl());
  const [stopRequested, setStopRequested] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const permissions = useSpendPermissions();
  const project = readProject(projectId);
  const shots = approvedWriterShots(project?.ai);
  if (!project || !shots.length) return null;
  const action = (label: string, run: () => void) => <Pressable accessibilityRole="button" disabled={disabled || lock.current} onPress={run} style={press({ minHeight: MIN_TAP, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text }}>{label}</Text></Pressable>;
  const save = (result: GenerationReviewResult) => {
    if (!result.ok) { setMessage(result.reason); return; }
    try {
      const current = readProject(projectId);
      if (!current) throw new Error('Project is no longer available.');
      writeProject({ ...current, ai: result.document }); setMessage('Review saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review could not be saved. Retry before assembling.'); }
  };
  const start = () => {
    if (lock.current || disabled) return;
    if (!connected || permissions.standingFor('video-generation') === 'reject') { setMessage('Connect the provider and allow video generation in Settings.'); return; }
    const current = readProject(projectId);
    if (!current) return;
    const batch = productionTextBatch(current.ai, model.id);
    if (!batch.ok) { setMessage(batch.reason); return; }
    const queue = batch.shots;
    const fingerprint = JSON.stringify(current.ai.writerPipeline);
    const estimate = estimateVideoPlanCost(queue.map(shot => ({ modelId: model.id, durationSeconds: shot.durationSeconds })));
    const cost = estimate.fullyPriced ? `Estimated $${estimate.totalUsd?.toFixed(2)} (rates as of ${PRICING_AS_OF}; actual charges may differ).` : 'The provider cost is unknown. Continue only if you accept unknown charges.';
    Alert.alert('Approve generation cost', `${queue.length} shots · ${model.label}\n${cost}\nResults will be saved with prompts, then wait for your review.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Generate shots', onPress: () => { void (async () => {
      if (lock.current || !mounted.current) return;
      if (!queueControl.current.begin()) return;
      setStopRequested(false);
      lock.current = true; onBusy(true);
      try {
        for (const shot of queue) {
          if (!queueControl.current.canSubmit()) break;
          const latest = readProject(projectId);
          if (!mounted.current || !latest || JSON.stringify(latest.ai.writerPipeline) !== fingerprint) throw new Error('Plan changed or screen closed. Remaining shots were not submitted.');
          const rechecked = productionTextBatch(latest.ai, model.id);
          if (!rechecked.ok || !rechecked.shots.some(item => item.id === shot.id)) throw new Error('A queued shot is no longer eligible. Review current results before starting another batch.');
          const id = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
          const added = addGenerationCandidate(latest.ai, { id, shotId: shot.id, providerId: model.providerId, modelId: model.id, capability: 'text_to_video', prompt: shot.prompt, createdAt: new Date().toISOString() });
          if (!added.ok) throw new Error(added.reason);
          writeProject({ ...latest, ai: added.document });
          if (mounted.current) setMessage(`Generating ${shot.label}…`);
          const result = await generateShot({ projectId, modelId: model.id, prompt: shot.prompt, durationSeconds: shot.durationSeconds, aspectRatio, operation: 'text_to_video', onProgress: () => {} });
          let saved = readProject(projectId);
          if (!saved) throw new Error('Project could not be read after generation.');
          if (!result.ok) {
            const failed = updateGenerationCandidate(saved.ai, id, { status: 'failed', updatedAt: new Date().toISOString() });
            if (failed.ok) writeProject({ ...saved, ai: failed.document });
            throw new Error(result.message);
          }
          saved = saveGeneratedVideoCandidate(saved, result.asset, { id, assetId: result.asset.id, prompt: shot.prompt, modelId: model.id, providerId: model.providerId, operation: 'text_to_video', durationSeconds: shot.durationSeconds, aspectRatio, createdAt: new Date().toISOString() });
          const completed = updateGenerationCandidate(saved.ai, id, { status: 'completed', outputAssetIds: [result.asset.id], updatedAt: new Date().toISOString() });
          if (!completed.ok) throw new Error(completed.reason);
          writeProject({ ...saved, ai: completed.document });
        }
        if (mounted.current) setMessage(queueControl.current.wasStopped() ? 'Stopped after saving the submitted take. Remaining shots were not submitted. Submitted jobs may incur charges; starting again requires fresh cost approval.' : 'Takes saved with their prompts. Review each take before assembling.');
      } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Production stopped.'); }
      finally { queueControl.current.finish(); lock.current = false; if (mounted.current) onBusy(false); }
    })(); } }]);
  };
  return <View style={{ gap: 10 }}>
    <Text style={{ color: theme.text, fontWeight: '600' }}>Approved plan · {shots.length} shots · {model.label}</Text>
    {action('Price & generate pending shots', start)}
    {lock.current && <><Text style={{ color: theme.textWeak }}>{stopRequested ? 'Stopping after the submitted take is saved…' : 'Stopping does not cancel submitted provider jobs or charges.'}</Text><Pressable accessibilityRole="button" disabled={stopRequested} onPress={() => { queueControl.current.requestStop(); setStopRequested(true); }} style={press({ minHeight: MIN_TAP, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text }}>Stop after current shot</Text></Pressable></>}
    {project.ai.generations.filter(candidate => shots.some(shot => shot.id === candidate.shotId) && candidate.status === 'completed').map(candidate => {
      const asset = project.assets.find(item => candidate.outputAssetIds.includes(item.id));
      return <View key={candidate.id} style={{ gap: 6 }}><Text style={{ color: theme.text }}>{shots.find(shot => shot.id === candidate.shotId)?.label} · {candidate.review?.decision ?? 'pending'}</Text>
        {asset && action('View take', () => setPreview(preview === candidate.id ? null : candidate.id))}
        {active && asset && preview === candidate.id && <TakePreview key={asset.id} uri={assetUri(projectId, asset)} />}
        {CONTINUITY_REVIEW_FIELDS.map(field => action(`${candidate.review?.continuity[field] === 'pass' ? '✓' : 'Review'} ${field}`, () => { const latest = readProject(projectId); if (latest) save(setCandidateContinuity(latest.ai, candidate.id, field, candidate.review?.continuity[field] === 'pass' ? 'unchecked' : 'pass', candidate.review?.notes ?? '')); }))}
        {action('Approve reviewed take', () => { const latest = readProject(projectId); if (latest) save(decideGenerationCandidate(latest.ai, candidate.id, 'approved', candidate.review?.notes ?? '', new Date().toISOString())); })}
      </View>;
    })}
    {action('Assemble approved cut', () => {
      try {
        const latest = readProject(projectId);
        if (!latest) throw new Error('Project is no longer available.');
        const result = assembleApprovedWriterShots(latest);
        setMessage(result.ok ? 'Approved cut assembled and saved.' : result.reason);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the assembled cut.'); }
    })}
    {!!message && <Text accessibilityRole="alert" style={{ color: theme.textWeak }}>{message}</Text>}
  </View>;
}
