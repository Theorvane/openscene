import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CONTINUITY_REVIEW_FIELDS } from '@openvideo/shared/aiProjectDomain';
import { approvedWriterShots } from '@openvideo/shared/writerPipeline';
import { productionTextBatch, productionTextShot } from '@openvideo/shared/productionPlan';
import { approveProductionScene, productionSceneRows, productionShotRows } from '@openvideo/shared/productionWorkflow';
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
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const lock = useRef(false);
  const queueControl = useRef(createProductionQueueControl());
  const [stopRequested, setStopRequested] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const permissions = useSpendPermissions();
  const project = readProject(projectId);
  const shots = approvedWriterShots(project?.ai);
  const scenes = productionSceneRows(project?.ai);
  const shotRows = productionShotRows(project?.ai);
  const selectedScene = scenes.find((scene) => scene.sceneId === selectedSceneId) ?? scenes.find((scene) => !scene.complete) ?? scenes[0];
  const visibleShotIds = new Set(project?.ai.shots.filter((shot) => shot.sceneId === selectedScene?.sceneId).map((shot) => shot.id) ?? []);
  if (!project || !shots.length) return null;
  const action = (label: string, run: () => void, blocked = false) => <Pressable accessibilityRole="button" disabled={disabled || lock.current || blocked} onPress={run} style={press({ minHeight: MIN_TAP, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text }}>{label}</Text></Pressable>;
  const save = (result: GenerationReviewResult) => {
    if (!result.ok) { setMessage(result.reason); return; }
    try {
      const current = readProject(projectId);
      if (!current) throw new Error('Project is no longer available.');
      writeProject({ ...current, ai: result.document }); setMessage('Review saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review could not be saved. Retry before assembling.'); }
  };
  const start = (shotId?: string) => {
    if (lock.current || disabled) return;
    if (!connected || permissions.standingFor('video-generation') === 'reject') { setMessage('Connect the provider and allow video generation in Settings.'); return; }
    const current = readProject(projectId);
    if (!current) return;
    const batch = shotId === undefined ? productionTextBatch(current.ai, model.id) : productionTextShot(current.ai, model.id, shotId);
    if (!batch.ok) { setMessage(batch.reason); return; }
    const queue = 'shots' in batch ? batch.shots : [batch.shot];
    const fingerprint = JSON.stringify(current.ai.writerPipeline);
    const estimate = estimateVideoPlanCost(queue.map(shot => ({ modelId: model.id, durationSeconds: shot.sourceDurationSeconds })));
    const longer = queue.filter(shot => shot.sourceDurationSeconds > shot.durationSeconds).length;
    const cost = estimate.fullyPriced ? `Estimated $${estimate.totalUsd?.toFixed(2)} (rates as of ${PRICING_AS_OF}; actual charges may differ).` : 'The provider cost is unknown. Continue only if you accept unknown charges.';
    Alert.alert('Approve generation cost', `${shotId === undefined ? `${queue.length} planned five-second shots` : `${queue[0]!.label} · ${current.ai.generations.some(item => item.shotId === shotId) ? 'regenerate one shot' : 'generate one shot'}`} · ${model.label}\n${shotId === undefined ? '' : `Planned prompt: ${queue[0]!.prompt}\n`}${longer} source clips exceed five seconds and will be trimmed to five seconds in the assembled cut. Cost uses full source lengths.\n${cost}\nThe existing approved take stays selected until you approve its replacement. An assembled cut is not changed automatically.\nResults will be saved with prompts, then wait for your review.`, [{ text: 'Cancel', style: 'cancel' }, { text: shotId === undefined ? 'Generate shots' : 'Generate shot', onPress: () => { void (async () => {
      if (lock.current || !mounted.current) return;
      if (!queueControl.current.begin()) return;
      setStopRequested(false);
      lock.current = true; onBusy(true);
      try {
        for (const shot of queue) {
          if (!queueControl.current.canSubmit()) break;
          const latest = readProject(projectId);
          if (!mounted.current || !latest || JSON.stringify(latest.ai.writerPipeline) !== fingerprint) throw new Error('Plan changed or screen closed. Remaining shots were not submitted.');
          const rechecked = shotId === undefined ? productionTextBatch(latest.ai, model.id) : productionTextShot(latest.ai, model.id, shotId);
          if (!rechecked.ok || !('shots' in rechecked ? rechecked.shots.some(item => item.id === shot.id) : rechecked.shot.id === shot.id)) throw new Error('A queued shot is no longer eligible. Review current results before starting another batch.');
          const id = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
          const added = addGenerationCandidate(latest.ai, { id, shotId: shot.id, providerId: model.providerId, modelId: model.id, capability: 'text_to_video', prompt: shot.prompt, createdAt: new Date().toISOString() });
          if (!added.ok) throw new Error(added.reason);
          writeProject({ ...latest, ai: added.document });
          if (mounted.current) setMessage(`Generating ${shot.label}…`);
          const result = await generateShot({ projectId, modelId: model.id, prompt: shot.prompt, durationSeconds: shot.sourceDurationSeconds, aspectRatio, operation: 'text_to_video', onProgress: () => {} });
          let saved = readProject(projectId);
          if (!saved) throw new Error('Project could not be read after generation.');
          if (!result.ok) {
            const failed = updateGenerationCandidate(saved.ai, id, { status: 'failed', updatedAt: new Date().toISOString() });
            if (failed.ok) writeProject({ ...saved, ai: failed.document });
            throw new Error(result.message);
          }
          saved = saveGeneratedVideoCandidate(saved, result.asset, { id, assetId: result.asset.id, prompt: shot.prompt, modelId: model.id, providerId: model.providerId, operation: 'text_to_video', durationSeconds: shot.sourceDurationSeconds, aspectRatio, createdAt: new Date().toISOString() });
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
    <Text style={{ color: theme.textWeak }}>One film sequence · {scenes.length} scenes · {Math.round(shots.reduce((total, shot) => total + shot.durationSeconds, 0) / 60)} planned min. Approve each scene, generate its shots after cost confirmation, then review every take before continuing. Approved takes join in story order; short takes block assembly.</Text>
    {scenes.map(scene => <View key={scene.sceneId} style={{ gap: 5, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 }}>
      <Text style={{ color: theme.text, fontWeight: '600' }}>Scene {scene.order + 1} · {scene.title}</Text>
      <Text style={{ color: theme.textWeak }}>{scene.setting} · {scene.timeOfDay} · {Math.round(scene.durationMs / 1000)}s · {scene.approvedShotCount}/{scene.shotCount} takes approved</Text>
      <Text style={{ color: theme.textWeak }}>{scene.objective} {scene.continuityNotes}</Text>
      {action(selectedScene?.sceneId === scene.sceneId ? 'Viewing scene takes' : 'View scene takes', () => setSelectedSceneId(scene.sceneId))}
      {action(scene.complete ? 'Scene complete' : scene.approved ? 'Scene approved · review takes' : scene.canApprove ? 'Approve this scene' : 'Finish previous scene first', () => {
        Alert.alert(`Approve scene ${scene.order + 1}?`, `${scene.title} will be available for media generation. Provider cost is confirmed separately.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Approve scene', onPress: () => { const latest = readProject(projectId); if (latest) save(approveProductionScene(latest.ai, scene.sceneId, new Date().toISOString())); } }
        ]);
      }, !scene.canApprove)}
    </View>)}
    {action('Price & generate approved scene shots', () => start(), !selectedScene?.canProduce || selectedScene.complete)}
    <Text style={{ color: theme.text, fontWeight: '600' }}>{selectedScene ? `Scene ${selectedScene.order + 1} shot prompts` : 'Shot prompts'}</Text>
    {shotRows.filter(row => row.sceneId === selectedScene?.sceneId).map(row => {
      const eligibility = productionTextShot(project.ai, model.id, row.shotId);
      const latest = project.ai.generations.filter(item => item.shotId === row.shotId).at(-1);
      return <View key={row.shotId} style={{ gap: 6, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 }}>
        <Text style={{ color: theme.text, fontWeight: '600' }}>{row.label} · {Math.round(row.durationMs / 1000)}s · {row.state}</Text>
        <Text style={{ color: theme.textWeak }}>Planned video prompt</Text>
        <Text selectable style={{ color: theme.text }}>{row.prompt}</Text>
        <Text style={{ color: theme.textWeak }}>{row.candidateCount} take(s){latest ? ` · Latest: ${latest.status} / ${latest.review?.decision ?? 'pending'}` : ''}{row.approvedGeneration ? ' · Approved take retained until replacement approval' : ''}</Text>
        {action(row.candidateCount > 0 ? 'Regenerate this shot · review cost' : 'Generate this shot · review cost', () => start(row.shotId), !eligibility.ok)}
        {!eligibility.ok && <Text style={{ color: theme.textWeak }}>{eligibility.reason}</Text>}
      </View>;
    })}
    {lock.current && <><Text style={{ color: theme.textWeak }}>{stopRequested ? 'Stopping after the submitted take is saved…' : 'Stopping does not cancel submitted provider jobs or charges.'}</Text><Pressable accessibilityRole="button" disabled={stopRequested} onPress={() => { queueControl.current.requestStop(); setStopRequested(true); }} style={press({ minHeight: MIN_TAP, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text }}>Stop after current shot</Text></Pressable></>}
    <Text style={{ color: theme.text, fontWeight: '600' }}>{selectedScene ? `Scene ${selectedScene.order + 1} takes` : 'Scene takes'}</Text>
    {project.ai.generations.filter(candidate => visibleShotIds.has(candidate.shotId) && candidate.status === 'completed').map(candidate => {
      const asset = project.assets.find(item => candidate.outputAssetIds.includes(item.id));
      return <View key={candidate.id} style={{ gap: 6 }}><Text style={{ color: theme.text }}>{shots.find(shot => shot.id === candidate.shotId)?.label} · {candidate.review?.decision ?? 'pending'}</Text><Text selectable style={{ color: theme.textWeak }}>Take prompt: {candidate.prompt}</Text>
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
