import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CONTINUITY_REVIEW_FIELDS } from '@openvideo/shared/aiProjectDomain';
import { approvedWriterShots } from '@openvideo/shared/writerPipeline';
import { productionDashboard } from '@openvideo/shared/productionDashboard';
import { productionTextBatch, productionTextShot } from '@openvideo/shared/productionPlan';
import { approveProductionScene, productionSceneRows, productionSceneSummary, productionSceneGuide, productionShotRows, productionShotVisual } from '@openvideo/shared/productionWorkflow';
import { createProductionQueueControl } from '@openvideo/shared/productionQueueControl';
import { addGenerationCandidate, updateGenerationCandidate, setCandidateContinuity, decideGenerationCandidate, type GenerationReviewResult } from '@openvideo/shared/generationReview';
import { estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { generateShot } from '../lib/videoGeneration';
import { readProject, writeProject, saveGeneratedVideoCandidate, assembleApprovedWriterShots, assetUri, type MobileAsset } from '../lib/projectStore';
import { useSpendPermissions } from '../lib/permissions';
import type { VideoAspectRatio } from '@openvideo/shared/videoGeneration';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

function TakePreview({ uri, height = 180 }: { uri: string; height?: number }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls style={{ height, width: '100%' }} />;
}
function StoryboardSlate({ projectId, asset, fallbackImage, state, description, height, showVideoPreview = false }: {
  projectId: string; asset: MobileAsset | undefined; fallbackImage?: MobileAsset; state: string;
  description: string; height: number; showVideoPreview?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset?.id, fallbackImage?.id]);
  const still = asset?.kind === 'image' ? asset : fallbackImage?.kind === 'image' ? fallbackImage : undefined;
  const videoVisible = asset?.kind === 'video' && showVideoPreview;
  return <View style={{ height, overflow: 'hidden', borderWidth: 1, borderColor: state === 'generating' ? theme.warn : state === 'approved' || state === 'complete' ? theme.mint : theme.line, borderRadius: 6, backgroundColor: theme.surface, justifyContent: 'center' }}>
    {videoVisible ? <TakePreview key={asset.id} uri={assetUri(projectId, asset)} height={height} />
      : still && !failed ? <Image source={{ uri: assetUri(projectId, still) }} resizeMode="cover" onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
      : <Text numberOfLines={4} style={{ color: state === 'generating' ? theme.warn : theme.text, fontSize: 13, textAlign: 'center', padding: 12 }}>{state === 'generating' ? '◉ GENERATING' : asset?.kind === 'video' ? `▶ ${description}` : description}</Text>}
    {!videoVisible && <Text style={{ position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: '#09090cdd', color: state === 'generating' || state === 'needs_review' ? theme.warn : '#ffffff', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{asset?.kind === 'video' ? '▶ APPROVED VIDEO' : failed ? 'FRAME UNAVAILABLE' : state === 'approved' || state === 'complete' ? 'APPROVED TAKE' : state === 'needs_review' || state === 'review' ? 'REVIEW TAKE' : state === 'generating' ? 'IN PRODUCTION' : still ? 'STORYBOARD FRAME' : 'SHOT PLAN'}</Text>}
  </View>;
}

export function ProductionRunBoard({ projectId, model, aspectRatio, disabled, connected, onBusy, active }: {
  projectId: string; model: { id: string; label: string; providerId: string }; aspectRatio: VideoAspectRatio;
  disabled: boolean; connected: boolean; onBusy: (busy: boolean) => void; active: boolean;
}) {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [storyboardPreviewId, setStoryboardPreviewId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [showScreenplay, setShowScreenplay] = useState(false);
  const [showProductionNotes, setShowProductionNotes] = useState(false);
  const [showFinalCut, setShowFinalCut] = useState(false);
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
  if (!project) return null;
  const dashboard = productionDashboard(project.ai, project.assets.map(asset => ({ id: asset.id, kind: asset.kind, durationMs: asset.durationMs ?? null })), project.name);
  // The planning screen above is the single entry point until the shot plan is approved.
  if (shots.length === 0) return null;
  const action = (label: string, run: () => void, blocked = false) => <Pressable accessibilityRole="button" disabled={disabled || lock.current || blocked} onPress={run} style={press({ minHeight: MIN_TAP, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text }}>{label}</Text></Pressable>;
  const save = (result: GenerationReviewResult) => {
    if (!result.ok) { setMessage(result.reason); return; }
    try {
      const current = readProject(projectId);
      if (!current) throw new Error('Project is no longer available.');
      writeProject({ ...current, ai: result.document }); setMessage('Review saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review could not be saved. Retry before assembling.'); }
  };
  const start = (selection: { shotId?: string; sceneId?: string }) => {
    const shotId = selection.shotId;
    if (lock.current || disabled) return;
    if (!connected || permissions.standingFor('video-generation') === 'reject') { setMessage('Connect the provider and allow video generation in Settings.'); return; }
    const current = readProject(projectId);
    if (!current) return;
    const batch = shotId === undefined ? productionTextBatch(current.ai, model.id, selection.sceneId) : productionTextShot(current.ai, model.id, shotId);
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
          const rechecked = shotId === undefined ? productionTextBatch(latest.ai, model.id, selection.sceneId) : productionTextShot(latest.ai, model.id, shotId);
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
  return <View style={{ gap: 18, backgroundColor: theme.bg, padding: 14, borderRadius: 8 }}>
    <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>OPENSCENE STUDIO · PRODUCTION</Text>
    <Text style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}>{dashboard.title}</Text>
    <Text style={{ color: theme.textWeak }}>{scenes.length} scenes · {shots.length} shots · {Math.round(shots.reduce((total, shot) => total + shot.durationSeconds, 0) / 60)} planned min</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showProductionNotes }} onPress={() => setShowProductionNotes(value => !value)} style={press({ minHeight: MIN_TAP, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text, fontWeight: '700' }}>{showProductionNotes ? 'Hide' : 'Show'} film progress and notes</Text></Pressable>
    {showProductionNotes && <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Production stages" contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
      {dashboard.stages.map((stage, index) => <View key={stage.id} style={{ width: 132, minHeight: 94, borderTopWidth: 3, borderColor: stage.state === 'complete' ? theme.mint : stage.state === 'active' ? theme.warn : theme.line, backgroundColor: theme.surface, padding: 10, gap: 5 }}>
        <Text style={{ color: stage.state === 'waiting' ? theme.textWeak : theme.warn, fontSize: 11 }}>{stage.state === 'complete' ? '✓' : String(index + 1).padStart(2, '0')} · {stage.state.toUpperCase()}</Text>
        <Text style={{ color: theme.text, fontWeight: '700' }}>{stage.label}</Text><Text numberOfLines={2} style={{ color: theme.textWeak, fontSize: 11 }}>{stage.detail}</Text>
      </View>)}
    </ScrollView>
    <View style={{ padding: 12, backgroundColor: theme.surface, borderLeftWidth: 3, borderColor: theme.warn }}><Text style={{ color: theme.warn, fontWeight: '700' }}>{dashboard.status}</Text></View>
    <View style={{ backgroundColor: theme.surface, padding: 20, borderRadius: 4, gap: 10 }}>
      <Text style={{ color: theme.warn, fontSize: 11, letterSpacing: 2, fontWeight: '700' }}>THE SCREENPLAY · {dashboard.screenplayApproved ? 'APPROVED' : 'WORKING SCRIPT'}</Text>
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>{dashboard.title}</Text>
      <Text style={{ color: theme.textWeak }}>{dashboard.scenes.length} scenes · {(dashboard.totalDurationMs / 60_000).toFixed(1)} planned min</Text>
      {dashboard.scenes.slice(0, 5).map(scene => <View key={scene.sceneId} style={{ borderTopWidth: 1, borderColor: theme.line, paddingTop: 10, gap: 3 }}>
        <Text style={{ color: theme.warn, fontSize: 11 }}>{String(scene.number).padStart(2, '0')} · {Math.round(scene.startMs / 1000)}–{Math.round(scene.endMs / 1000)}s</Text>
        <Text style={{ color: theme.text, fontWeight: '700' }}>{scene.title}</Text><Text style={{ color: theme.textWeak }}>{scene.objective}</Text>
      </View>)}
      {dashboard.scenes.length > 5 && <Text style={{ color: theme.textWeak }}>+ {dashboard.scenes.length - 5} more scenes in the story reel</Text>}
      {!!dashboard.screenplay && <Pressable accessibilityRole="button" onPress={() => setShowScreenplay(!showScreenplay)} style={press({ minHeight: MIN_TAP, justifyContent: 'center', borderTopWidth: 1, borderColor: theme.line })}><Text style={{ color: theme.accent, fontWeight: '700' }}>{showScreenplay ? 'Hide full screenplay' : 'Read full screenplay'}</Text></Pressable>}
      {showScreenplay && !!dashboard.screenplay && <Text selectable style={{ color: theme.text, lineHeight: 22 }}>{dashboard.screenplay}</Text>}
    </View>
    <View style={{ borderWidth: 1, borderColor: theme.line, padding: 14, gap: 9 }}><Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Decisions</Text>
      {dashboard.decisions.length === 0 ? <Text style={{ color: theme.textWeak }}>No style decisions recorded yet.</Text> : dashboard.decisions.map(item => <View key={item.label}><Text style={{ color: theme.warn, fontSize: 11 }}>{item.label} · {item.source}</Text><Text style={{ color: theme.text }}>{item.value}</Text></View>)}
    </View>
    <View style={{ borderWidth: 1, borderColor: theme.line, padding: 14, gap: 9 }}><Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Activity</Text>
      {dashboard.activity.length === 0 ? <Text style={{ color: theme.textWeak }}>Scene approvals and generation results will appear here.</Text> : dashboard.activity.map(item => <View key={item.id}><Text style={{ color: theme.warn, fontSize: 11 }}>{item.at.slice(0, 16).replace('T', ' ')} · {item.label}</Text><Text style={{ color: theme.text }}>{item.detail}</Text></View>)}
    </View>
    </>}
    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 17 }}>Scenes in story order</Text>
    <Text style={{ color: theme.textWeak, fontSize: 12 }}>Select the current scene, finish its five-second shots, then continue. Assembly joins approved scenes on the timeline.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 16 }} accessibilityLabel="Scene sequence">
      {scenes.map(scene => { const summary = productionSceneSummary(scene, shotRows); const selected = scene.sceneId === selectedScene?.sceneId; const sceneRows = shotRows.filter(row => row.sceneId === scene.sceneId); const visualRow = sceneRows.find(row => { const visual = productionShotVisual(row); return visual.takeAssetId || visual.storyboardAssetId; }) ?? sceneRows[0]; const visual = visualRow ? productionShotVisual(visualRow) : null; const asset = project.assets.find(item => item.id === (visual?.takeAssetId ?? visual?.storyboardAssetId)) ?? project.assets.find(item => item.id === visual?.storyboardAssetId); const fallbackImage = project.assets.find(item => item.id === visual?.storyboardAssetId); return <Pressable key={scene.sceneId} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setSelectedSceneId(scene.sceneId)} style={press({ width: Math.max(210, Math.min(300, 190 + scene.durationMs / 1000)), padding: 8, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.warn : theme.line, borderRadius: 8, gap: 7, backgroundColor: theme.surface })}>
        <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>SC {String(scene.order + 1).padStart(2, '0')} · {Math.round(scene.durationMs / 1000)}s</Text>
        <StoryboardSlate projectId={projectId} asset={asset} fallbackImage={fallbackImage} state={summary.stage} description={scene.objective} height={116} />
        <Text numberOfLines={2} style={{ color: theme.text, fontWeight: '700' }}>{scene.title}</Text>
        <Text style={{ color: theme.textWeak }}>{scene.approvedShotCount}/{scene.shotCount} shots approved</Text>
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{summary.stage === 'approval' ? 'Ready to approve' : summary.stage === 'generate' ? 'Ready to generate' : summary.stage === 'review' ? 'Review takes' : summary.stage === 'generating' ? 'Generating' : summary.stage === 'complete' ? 'Complete' : 'Locked'}</Text>
        <View style={{ height: 3, backgroundColor: theme.line, borderRadius: 3 }}><View style={{ height: 3, width: `${scene.shotCount ? scene.approvedShotCount / scene.shotCount * 100 : 0}%`, backgroundColor: theme.text, borderRadius: 3 }} /></View>
      </Pressable>; })}
    </ScrollView>
    {selectedScene && <View style={{ gap: 7, padding: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 9 }}>
      <Text style={{ color: theme.textWeak, fontSize: 11 }}>SCENE {String(selectedScene.order + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}</Text>
      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 18 }}>{selectedScene.title}</Text>
      <Text style={{ color: theme.text }}>{selectedScene.objective}</Text>
      <Text style={{ color: theme.textWeak }}>{selectedScene.setting} · {selectedScene.timeOfDay} · {Math.round(selectedScene.durationMs / 1000)}s · {selectedScene.shotCount} shots</Text>
      {!!selectedScene.continuityNotes && <Text style={{ color: theme.textWeak }}>Continuity: {selectedScene.continuityNotes}</Text>}
      {(() => { const summary = productionSceneSummary(selectedScene, shotRows); const guide = productionSceneGuide(selectedScene, shotRows, scenes.some(scene => scene.order > selectedScene.order)); return <>
        <View style={{ padding: 12, borderLeftWidth: 3, borderColor: theme.warn, backgroundColor: theme.surface, gap: 5 }}><Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700' }}>{guide.step}</Text><Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{guide.title}</Text><Text style={{ color: theme.textWeak, lineHeight: 19 }}>{guide.detail}</Text></View>
        <Text style={{ color: theme.textWeak }}>{summary.pendingCount} pending · {summary.reviewCount} to review · {selectedScene.approvedShotCount} approved</Text>
        {summary.stage === 'approval' && action('Approve scene', () => {
          Alert.alert(`Approve scene ${selectedScene.order + 1}?`, `${selectedScene.title} will be available for media generation. Provider cost is confirmed separately.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Approve scene', onPress: () => { const latest = readProject(projectId); if (latest) save(approveProductionScene(latest.ai, selectedScene.sceneId, new Date().toISOString())); } }
          ]);
        })}
        {summary.stage === 'generate' && action(`Generate ${summary.pendingCount} shot(s) · review cost`, () => start({ sceneId: selectedScene.sceneId }))}
        {summary.stage === 'review' && <Text style={{ color: theme.textWeak }}>Review the next take below, then approve it.</Text>}
        {summary.stage === 'complete' && scenes.some(scene => scene.order > selectedScene.order) && action('Continue to next scene', () => setSelectedSceneId(scenes[scenes.findIndex(scene => scene.sceneId === selectedScene.sceneId) + 1]!.sceneId))}
        {summary.stage === 'complete' && !scenes.some(scene => scene.order > selectedScene.order) && action('Assemble final cut', () => {
          try {
            const latest = readProject(projectId);
            if (!latest) throw new Error('Project is no longer available.');
            const result = assembleApprovedWriterShots(latest);
            setMessage(result.ok ? 'Approved cut assembled and saved.' : result.reason);
          } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the assembled cut.'); }
        }, !dashboard.assemblyReady)}
      </>; })()}
    </View>}
    <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>SHOT BOARD</Text><Text style={{ color: theme.text, fontWeight: '700', fontSize: 18 }}>{selectedScene ? `Scene ${selectedScene.order + 1} · ${selectedScene.title}` : 'Shot prompts'}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 16 }} accessibilityLabel="Scene shot board">
    {shotRows.filter(row => row.sceneId === selectedScene?.sceneId).map((row, index) => {
      const visual = productionShotVisual(row);
      const image = project.assets.find(item => item.id === visual.storyboardAssetId);
      const asset = project.assets.find(item => item.id === (visual.takeAssetId ?? visual.storyboardAssetId)) ?? image;
      const eligibility = productionTextShot(project.ai, model.id, row.shotId);
      const latest = project.ai.generations.filter(item => item.shotId === row.shotId).at(-1);
      return <View key={row.shotId} style={{ width: 282, gap: 8, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>SH {String(index + 1).padStart(2, '0')} · {Math.round(row.durationMs / 1000)}s</Text>
        <StoryboardSlate projectId={projectId} asset={asset} fallbackImage={image} state={row.state} description={row.label} height={146} showVideoPreview={active && storyboardPreviewId === row.shotId} />
        {asset?.kind === 'video' && action(storyboardPreviewId === row.shotId ? 'Close approved take preview' : 'Preview approved take', () => setStoryboardPreviewId(storyboardPreviewId === row.shotId ? null : row.shotId))}
        <Text style={{ color: theme.text, fontWeight: '700' }}>{row.label}</Text>
        <Text style={{ color: theme.warn, fontSize: 11, letterSpacing: 1 }}>Planned video prompt</Text>
        <Text selectable style={{ color: theme.text, fontSize: 12, lineHeight: 18 }}>{row.prompt}</Text>
        <Text style={{ color: theme.textWeak }}>{row.candidateCount} take(s){latest ? ` · Latest: ${latest.status} / ${latest.review?.decision ?? 'pending'}` : ''}{row.approvedGeneration ? ' · Approved take retained until replacement approval' : ''}</Text>
        {action(row.candidateCount > 0 ? 'Regenerate this shot · review cost' : 'Generate this shot · review cost', () => start({ shotId: row.shotId }), !eligibility.ok)}
        {!eligibility.ok && <Text style={{ color: theme.textWeak }}>{eligibility.reason}</Text>}
      </View>;
    })}
    </ScrollView>
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
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFinalCut }} onPress={() => setShowFinalCut(value => !value)} style={press({ minHeight: MIN_TAP, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={{ color: theme.text, fontWeight: '700' }}>{showFinalCut ? 'Hide' : 'Show'} final-cut details</Text></Pressable>
    {showFinalCut && <>
    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 18 }}>Final cut</Text>
    <Text style={{ color: theme.textWeak }}>{dashboard.assemblyReady ? 'Approved takes are ready to assemble.' : 'Awaiting approved takes for every planned shot.'}</Text>
    {action('Assemble approved cut', () => {
      try {
        const latest = readProject(projectId);
        if (!latest) throw new Error('Project is no longer available.');
        const result = assembleApprovedWriterShots(latest);
        setMessage(result.ok ? 'Approved cut assembled and saved.' : result.reason);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the assembled cut.'); }
    })}
    </>}
    {!!message && <Text accessibilityRole="alert" style={{ color: theme.textWeak }}>{message}</Text>}
  </View>;
}
