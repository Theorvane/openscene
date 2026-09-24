import { useEffect, useState, type ReactElement } from 'react';

import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { productionDashboard } from '../../shared/productionDashboard';
import {
  activeStyleReference,
  batchableProductionVideoShotIds,
  approveProductionScene,
  addCharacterReference,
  assignStyleReference,
  assignStoryboardReference,
  buildApprovedProductionAssemblyPlan,
  clearStoryboardReference,
  clearStyleReference,
  missingProductionImageTargets,
  productionShotRows,
  productionShotVisual,
  productionShotRegenerationBlockReason,
  productionSceneRows,
  productionSceneSummary,
  productionSceneGuide,
  removeCharacterReference,
  type ProductionImageTarget,
  type ProductionMutationResult
} from '../../shared/productionWorkflow';
import type { MediaAsset } from '../../shared/timelineTypes';
import { Button, StatusCard } from './ui';

const STATE_LABELS = {
  not_started: 'Not started', generating: 'Generating', needs_import: 'Needs import',
  needs_review: 'Needs review', approved: 'Approved', failed: 'Failed'
} as const;

function StoryboardSlate({ projectId, asset, state, description }: {
  readonly projectId: string;
  readonly asset: MediaAsset | undefined;
  readonly state: string;
  readonly description: string;
}): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (asset && (asset.kind === 'image' || asset.kind === 'video')) {
      void window.videoTool.getAssetPlaybackUrl({ projectId, assetId: asset.id }).then((result) => {
        if (live) { if (result.ok) setUrl(result.value.url); else setFailed(true); }
      }).catch(() => { if (live) setFailed(true); });
    }
    return () => { live = false; };
  }, [projectId, asset?.id]);
  return <span className={`production-board__slate production-board__slate--${state}`}>
    {url && !failed && asset?.kind === 'image' && <img src={url} alt="" onError={() => setFailed(true)} />}
    {url && !failed && asset?.kind === 'video' && <video src={url} muted playsInline preload="metadata" onError={() => setFailed(true)} />}
    {(!url || failed) && <span className="production-board__slate-copy">{state === 'generating' ? '◉ GENERATING' : description}</span>}
    <span className="production-board__slate-tag">{failed ? 'MEDIA UNAVAILABLE' : state === 'approved' || state === 'complete' ? 'APPROVED TAKE' : state === 'needs_review' ? 'TAKE TO REVIEW' : state === 'generating' ? 'IN PRODUCTION' : asset?.kind === 'image' ? 'STORYBOARD FRAME' : 'SHOT PLAN'}</span>
  </span>;
}

export function ProductionBoard({
  projectId, projectName, modelLabel, document, assets, busy, onSave, onOpenShot, onGenerateCharacterImage, onGenerateStoryboardImage,
  onGenerateImages, onOpenImageResults, onGenerateVideoScene, onGenerateVideoShot, onAssemble, onOpenPlan
}: {
  readonly projectId: string;
  readonly projectName?: string | undefined;
  readonly modelLabel: string;
  readonly document: AiProjectDocument;
  readonly assets: readonly MediaAsset[];
  readonly busy: boolean;
  readonly onSave: (document: AiProjectDocument) => Promise<boolean>;
  readonly onOpenShot: (shotId: string) => Promise<void>;
  /** Returns an actionable reason when the image brief cannot be opened. */
  readonly onGenerateCharacterImage: (characterId: string) => string | null;
  readonly onGenerateStoryboardImage: (shotId: string) => string | null;
  readonly onGenerateImages: (targets: readonly ProductionImageTarget[]) => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onOpenImageResults: () => void;
  readonly onGenerateVideoShot: (shotId: string) => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onGenerateVideoScene: (sceneId: string) => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onAssemble: () => boolean;
  readonly onOpenPlan: () => void;
}): ReactElement | null {
  const [saving, setSaving] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string } | null>(null);
  const rows = productionShotRows(document);
  const scenes = productionSceneRows(document);
  const selectedScene = scenes.find((scene) => scene.sceneId === selectedSceneId) ?? scenes.find((scene) => !scene.complete) ?? scenes[0];
  const visibleRows = rows.filter((row) => row.sceneId === selectedScene?.sceneId);
  const activeCharacterIds = new Set(rows.flatMap((row) => row.characterIds));
  const activeCharacters = document.characters.filter((character) => activeCharacterIds.has(character.id));
  const missingCharacterTargets = missingProductionImageTargets(document, 'character_reference');
  const missingStoryboardTargets = missingProductionImageTargets(document, 'storyboard')
    .filter((target) => target.kind === 'storyboard' && rows.some((row) => row.shotId === target.shotId && row.sceneId === selectedScene?.sceneId));
  const pendingVideoShotIds = batchableProductionVideoShotIds(document, selectedScene?.sceneId);
  const images = assets.filter((asset) => asset.kind === 'image');
  const imageById = new Map(images.map((asset) => [asset.id, asset]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const referenceById = new Map(document.referenceAssets.map((entry) => [entry.id, entry]));
  const styleReference = activeStyleReference(document);
  const assembly = buildApprovedProductionAssemblyPlan(document, assets.map((asset) => ({
    id: asset.id, kind: asset.kind, durationMs: asset.metadata?.durationMs ?? null
  })));
  const dashboard = productionDashboard(document, assets.map((asset) => ({ id: asset.id, kind: asset.kind, durationMs: asset.metadata?.durationMs ?? null })), projectName);

  const runImages = async (targets: readonly ProductionImageTarget[]): Promise<void> => {
    setBatchBusy(true);
    setMessage({ tone: 'neutral', text: `Starting ${targets.length} production image job(s). Open Image Generation to watch results; the queue continues one at a time.` });
    try {
      setMessage(await onGenerateImages(targets));
    } catch (error: unknown) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The production image queue failed.' });
    } finally {
      setBatchBusy(false);
    }
  };

  const runVideoBatch = async (shotId?: string): Promise<void> => {
    setBatchBusy(true);
    setMessage({ tone: 'neutral', text: shotId === undefined ? 'Preparing this scene’s pending shots, reference inputs and cost confirmation.' : 'Preparing this shot, its reference inputs and cost confirmation.' });
    try {
      setMessage(await (shotId === undefined ? onGenerateVideoScene(selectedScene!.sceneId) : onGenerateVideoShot(shotId)));
    } catch (error: unknown) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The production video queue failed.' });
    } finally {
      setBatchBusy(false);
    }
  };

  const persist = async (result: ProductionMutationResult, success: string): Promise<void> => {
    if (!result.ok) {
      setMessage({ tone: 'warning', text: result.reason });
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(result.document);
      setMessage(saved
        ? { tone: 'success', text: success }
        : { tone: 'danger', text: 'The production mapping could not be saved. No provider job was started.' });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: `The production mapping could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}. No provider job was started.`
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="production-board" aria-labelledby="production-board-title">
      <header className="production-board__header">
        <div>
          <span className="production-board__eyebrow">OPENSCENE STUDIO · PRODUCTION</span><h3 id="production-board-title">{dashboard.title}</h3>
          <p>{scenes.length > 0 ? `${scenes.length} scenes · ${(scenes.reduce((total, scene) => total + scene.durationMs, 0) / 60_000).toFixed(1)} planned min · Five-second shots, made and reviewed scene by scene.` : 'Write the brief, review the screenplay, then direct each five-second shot scene by scene.'}</p>
          {rows.length > 0 && <small className="production-board__model">Shot model: {modelLabel} · Change it in a shot workbench before generating</small>}
        </div>
        <StatusCard tone={assembly.ok ? 'success' : 'neutral'}>{rows.length > 0 ? `${rows.filter((row) => row.state === 'approved').length}/${rows.length} shots approved` : 'Planning'}</StatusCard>
      </header>

      <details className="production-board__production-notes"><summary>Film progress, screenplay and activity</summary>
      <nav className="production-board__pipeline" aria-label="Production stages">{dashboard.stages.map((stage, index) => <div key={stage.id} className={`production-board__pipeline-step production-board__pipeline-step--${stage.state}`} title={stage.detail}>
        <span>{stage.state === 'complete' ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{stage.label}</strong><small>{stage.detail}</small>
      </div>)}</nav>
      <div className="production-board__status" role="status"><span className="production-board__status-light" />{dashboard.status}</div>
      <div className="production-board__overview">
        <section className="production-board__script" aria-label="Screenplay">
          <div className="production-board__script-meta"><span>THE SCREENPLAY</span><span>{dashboard.screenplayApproved ? 'APPROVED SCRIPT' : 'WORKING SCRIPT'}</span></div>
          <h4>{dashboard.title}</h4>
          <p className="production-board__script-subtitle">{dashboard.scenes.length > 0 ? `${dashboard.scenes.length} scenes · ${(dashboard.totalDurationMs / 60_000).toFixed(1)} planned min` : 'Scene pages will appear after the shot plan is approved.'}</p>
          {dashboard.scenes.length === 0 && <p className="production-board__script-empty">{dashboard.screenplay ? 'The screenplay is ready to review in the planning controls below.' : 'Every film begins with a brief. Describe the story below to start writing this one.'}</p>}
          {dashboard.scenes.slice(0, 5).map((scene) => <div className="production-board__script-scene" key={scene.sceneId}>
            <span>{String(scene.number).padStart(2, '0')} / {Math.round(scene.startMs / 1000)}–{Math.round(scene.endMs / 1000)}s</span>
            <strong>{scene.title}</strong><p>{scene.objective}</p>
          </div>)}
          {dashboard.scenes.length > 5 && <p className="production-board__script-more">+ {dashboard.scenes.length - 5} more scenes in the story reel</p>}
          {dashboard.screenplay && <details><summary>Read full screenplay</summary><pre>{dashboard.screenplay}</pre></details>}
        </section>
        <aside className="production-board__overview-side">
          <section className="production-board__log" aria-label="Production decisions"><h4>Decisions <span>{dashboard.decisions.length}</span></h4>
            {dashboard.decisions.length === 0 ? <p>No style decisions recorded yet.</p> : dashboard.decisions.map((item) => <div key={item.label}><small>{item.label} · {item.source}</small><p>{item.value}</p></div>)}
          </section>
          <section className="production-board__log" aria-label="Production activity"><h4>Activity <span>{dashboard.activity.length}</span></h4>
            {dashboard.activity.length === 0 ? <p>Scene approvals and generation results will appear here.</p> : dashboard.activity.map((item) => <div key={item.id}><small>{item.at.slice(0, 16).replace('T', ' ')} · {item.label}</small><p>{item.detail}</p></div>)}
          </section>
        </aside>
      </div>
      </details>

      {message !== null && <StatusCard tone={message.tone}>{message.text}</StatusCard>}

      {rows.length === 0 ? <section className="production-board__empty-reel" aria-label="Story reel awaiting plan">
        <div><span>STORY REEL / 00 SCENES</span><h4>{document.writerPipeline?.artifacts.length ? 'Review the plan to unlock scene 1' : 'Your first scene starts with a story brief'}</h4><p>{document.writerPipeline?.artifacts.length ? 'Approve the story, screenplay, scene order and five-second shot prompts above. Scene 1 appears here after the final approval.' : 'Write the brief above, propose a plan, then approve its screenplay, scene order and five-second shot prompts. Scene 1 appears here after the final approval.'}</p></div>
        <button type="button" className="button button--primary" onClick={onOpenPlan}>{document.writerPipeline?.artifacts.length ? 'Review screenplay and scene plan' : 'Write the story brief'}</button>
      </section> : <>
      <section className="production-board__scenes" aria-label="Film scenes">
        <h4>Scenes in story order <span>Select the highlighted scene, finish its five-second shots, then continue right. Assembly connects approved scenes on the timeline.</span></h4>
        <ol>{scenes.map((scene) => {
          const summary = productionSceneSummary(scene, rows);
          const sceneRows = rows.filter((row) => row.sceneId === scene.sceneId);
          const visualRow = sceneRows.find((row) => { const visual = productionShotVisual(row); return visual.takeAssetId || visual.storyboardAssetId; }) ?? sceneRows[0];
          const visual = visualRow ? productionShotVisual(visualRow) : null;
          const asset = assetById.get(visual?.takeAssetId ?? visual?.storyboardAssetId ?? '');
          return <li key={scene.sceneId} style={{ flexBasis: Math.max(220, Math.min(360, 190 + scene.durationMs / 1000 * 2)) }} className={selectedScene?.sceneId === scene.sceneId ? 'production-board__scene--selected' : ''}>
            <button type="button" aria-current={selectedScene?.sceneId === scene.sceneId ? 'step' : undefined} onClick={() => setSelectedSceneId(scene.sceneId)}>
              <span className="production-board__scene-number">SC {String(scene.order + 1).padStart(2, '0')}</span>
              <StoryboardSlate projectId={projectId} asset={asset} state={summary.stage} description={scene.objective} />
              <strong>{scene.title}</strong>
              <span>{(scene.durationMs / 1000).toFixed(0)}s · {scene.approvedShotCount}/{scene.shotCount} shots approved</span>
              <span className={`production-board__scene-stage production-board__scene-stage--${summary.stage}`}>{summary.stage === 'approval' ? 'Ready to approve' : summary.stage === 'generate' ? 'Ready to generate' : summary.stage === 'review' ? 'Review takes' : summary.stage === 'generating' ? 'Generating' : summary.stage === 'complete' ? 'Complete' : 'Locked'}</span>
              <span className="production-board__scene-progress"><span style={{ width: `${scene.shotCount ? scene.approvedShotCount / scene.shotCount * 100 : 0}%` }} /></span>
            </button>
          </li>;
        })}</ol>
      </section>

      {selectedScene && <section className="production-board__scene-workspace" aria-label={`Scene ${selectedScene.order + 1} workspace`}>
        <div className="production-board__scene-brief">
          <span>SCENE {String(selectedScene.order + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}</span>
          <h4>{selectedScene.title}</h4>
          <p>{selectedScene.objective}</p>
          <small>{selectedScene.setting} · {selectedScene.timeOfDay} · {(selectedScene.durationMs / 1000).toFixed(0)}s · {selectedScene.shotCount} planned shots</small>
          {selectedScene.continuityNotes && <small>Continuity: {selectedScene.continuityNotes}</small>}
        </div>
        <div className="production-board__scene-workspace-actions">
          {(() => {
            const summary = productionSceneSummary(selectedScene, rows);
            const guide = productionSceneGuide(selectedScene, rows, scenes.some((scene) => scene.order > selectedScene.order));
            return <>
              <div className="production-board__scene-guide"><small>{guide.step}</small><strong>{guide.title}</strong><p>{guide.detail}</p></div>
              <span>{selectedScene.approvedShotCount}/{selectedScene.shotCount} shots approved · {summary.pendingCount} pending · {summary.reviewCount} to review</span>
              {summary.stage === 'approval' && <Button variant="primary" disabled={busy || saving || batchBusy || !selectedScene.canApprove} onClick={() => {
                if (!window.confirm(`Approve scene ${selectedScene.order + 1}: ${selectedScene.title} for production? Media generation has a separate cost confirmation.`)) return;
                void persist(approveProductionScene(document, selectedScene.sceneId, new Date().toISOString()), `${selectedScene.title} is ready for production.`);
              }}>Approve scene {selectedScene.order + 1}</Button>}
              {summary.stage === 'generate' && <Button variant="primary" disabled={busy || saving || batchBusy || pendingVideoShotIds.length === 0} onClick={() => void runVideoBatch()}>Generate {pendingVideoShotIds.length} shots · review cost</Button>}
              {summary.stage === 'review' && <Button variant="primary" onClick={() => { const shot = visibleRows.find((row) => row.state === 'needs_review' || row.state === 'needs_import'); if (shot) void onOpenShot(shot.shotId); }}>Review next take</Button>}
              {summary.stage === 'complete' && scenes.some((scene) => scene.order > selectedScene.order) && <Button variant="primary" onClick={() => setSelectedSceneId(scenes[scenes.findIndex((scene) => scene.sceneId === selectedScene.sceneId) + 1]!.sceneId)}>Continue to scene {selectedScene.order + 2}</Button>}
              {summary.stage === 'complete' && !scenes.some((scene) => scene.order > selectedScene.order) && <Button variant="primary" disabled={busy || saving || !assembly.ok} onClick={() => {
                const assembled = onAssemble();
                setMessage({ tone: assembled ? 'success' : 'warning', text: assembled ? 'Approved shots are on the timeline. Review the cut before export.' : 'The cut could not be assembled. Check the final-cut requirements below.' });
              }}>Assemble final cut</Button>}
              {selectedScene.canProduce && missingStoryboardTargets.length > 0 && <details className="production-board__scene-options"><summary>Optional · create storyboard frames</summary><Button variant="default" disabled={busy || saving || batchBusy} onClick={() => void runImages(missingStoryboardTargets)}>Generate {missingStoryboardTargets.length} storyboard frame(s)</Button></details>}
            </>;
          })()}
        </div>
      </section>}

      <details className="production-board__references"><summary>Project references · world style and characters</summary>
      <div className="production-board__characters">
        <h4>World/style reference</h4>
        <p>Choose one approved image as the visual source of truth for every character sheet and storyboard frame in this project. It is attached first; up to two character images fill the remaining provider reference slots.</p>
        <select
          aria-label="World and visual style reference"
          disabled={busy || saving || batchBusy || images.length === 0}
          value={styleReference?.assetId ?? ''}
          onChange={(event) => {
            const asset = imageById.get(event.target.value);
            void persist(asset === undefined
              ? clearStyleReference(document)
              : assignStyleReference(document, {
                assetId: asset.id,
                referenceId: `style-reference-${crypto.randomUUID()}`,
                label: `World style · ${asset.displayName}`
              }), asset === undefined
                ? 'Cleared the world/style reference.'
                : `${asset.displayName} is now the world/style reference for this project.`);
          }}
        >
          <option value="">{images.length === 0 ? 'Import a style image in Editing first' : 'No world/style image'}</option>
          {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
        </select>
      </div>

      <div className="production-board__characters">
        <h4>Character reference library</h4>
        {activeCharacters.length === 0 && <span>This Writer version has no named characters.</span>}
        {activeCharacters.map((character) => {
          const assigned = character.referenceAssetIds.map((id) => ({ id, reference: referenceById.get(id) })).filter((entry) => entry.reference?.role === 'character');
          return <div className="production-board__character" key={character.id}>
            <strong>{character.name}</strong>
            <span>{character.invariantDescription}</span>
            <div className="production-board__reference-list">
              {assigned.map(({ id, reference }) => <span className="production-board__reference" key={id}>
                {imageById.get(reference!.assetId)?.displayName ?? reference!.label}
                <button type="button" disabled={busy || saving} aria-label={`Remove ${reference!.label} from ${character.name}`}
                  onClick={() => void persist(removeCharacterReference(document, character.id, id), `Removed a reference from ${character.name}.`)}>×</button>
              </span>)}
              <select aria-label={`Add image reference for ${character.name}`} disabled={busy || saving || assigned.length >= 3 || images.length === 0} value=""
                onChange={(event) => {
                  const asset = imageById.get(event.target.value);
                  if (asset === undefined) return;
                  void persist(addCharacterReference(document, {
                    characterId: character.id, assetId: asset.id,
                    referenceId: `character-reference-${crypto.randomUUID()}`,
                    label: `${character.name} · ${asset.displayName}`
                  }), `Assigned ${asset.displayName} to ${character.name}.`);
                }}>
                <option value="">{images.length === 0 ? 'Import images in Editing first' : 'Add project image…'}</option>
                {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
              </select>
              <Button
                variant="ghost"
                disabled={busy || saving || batchBusy || assigned.length >= 3}
                onClick={() => {
                  const reason = onGenerateCharacterImage(character.id);
                  if (reason !== null) setMessage({ tone: 'warning', text: reason });
                }}
              >Edit reference brief</Button>
              <Button
                variant="primary"
                disabled={busy || saving || batchBusy || assigned.length >= 3}
                onClick={() => void runImages([{ kind: 'character_reference', characterId: character.id }])}
              >Generate now</Button>
            </div>
          </div>;
        })}
      </div>

      </details>

      <div className="production-board__shot-section-title"><span>SHOT BOARD</span><h4>{selectedScene ? `Scene ${selectedScene.order + 1} · ${selectedScene.title}` : 'Planned shots'}</h4><small>Each card is a five-second beat. Review its prompt and take before moving on.</small></div>
      <ol className="production-board__shots">
        {visibleRows.map((row, index) => {
          const latestTake = document.generations.filter((candidate) => candidate.shotId === row.shotId).at(-1);
          const generationBlock = productionShotRegenerationBlockReason(document, row.shotId);
          const visual = productionShotVisual(row);
          const visualAsset = assetById.get(visual.takeAssetId ?? visual.storyboardAssetId ?? '');
          return <li className="production-board__shot" key={row.shotId}>
          <div className="production-board__shot-slate-heading"><span>SC {String((selectedScene?.order ?? 0) + 1).padStart(2, '0')} / SH {String(index + 1).padStart(2, '0')}</span><span>{(row.durationMs / 1000).toFixed(0)}s</span></div>
          <StoryboardSlate projectId={projectId} asset={visualAsset} state={row.state} description={row.label} />
          <div className="production-board__shot-heading"><strong>{row.label}</strong><span className={`production-board__state production-board__state--${row.state}`}>{STATE_LABELS[row.state]}</span></div>
          <div className="production-board__prompt"><strong>Planned video prompt</strong><p>{row.prompt}</p></div>
          {latestTake && <p className="production-board__take-summary">Latest take: {latestTake.status} · {latestTake.review?.decision ?? 'pending'}{latestTake.prompt !== row.prompt ? <> · Used prompt: {latestTake.prompt}</> : null}</p>}
          <div className="production-board__take-count">{row.candidateCount} take(s) · {row.characterReferenceIds.length} character reference(s)</div>
          <details className="production-board__shot-settings"><summary>Frames and generation settings</summary>
          <label className="studio-field">
            <span className="studio-field__label">Storyboard / first frame</span>
            <select disabled={busy || saving || images.length === 0} value={row.storyboardReference?.assetId ?? ''} onChange={(event) => {
              const asset = imageById.get(event.target.value);
              void persist(asset === undefined
                ? clearStoryboardReference(document, row.shotId)
                : assignStoryboardReference(document, {
                  shotId: row.shotId, assetId: asset.id,
                  referenceId: `storyboard-reference-${crypto.randomUUID()}`,
                  label: `Storyboard · ${row.label} · ${asset.displayName}`
                }), asset === undefined ? `Cleared the storyboard image for ${row.label}.` : `Mapped ${asset.displayName} to ${row.label}.`);
            }}>
              <option value="">{images.length === 0 ? 'Import storyboard images in Editing first' : 'No storyboard image'}</option>
              {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
            </select>
          </label>
          <div className="production-board__shot-actions">
            <Button variant="ghost" disabled={busy || saving || batchBusy || !scenes.some((scene) => scene.sceneId === row.sceneId && scene.canProduce)} onClick={() => {
              const reason = onGenerateStoryboardImage(row.shotId);
              if (reason !== null) setMessage({ tone: 'warning', text: reason });
            }}>Edit storyboard brief</Button>
            <Button variant="primary" disabled={busy || saving || batchBusy || !scenes.some((scene) => scene.sceneId === row.sceneId && scene.canProduce)} onClick={() => void runImages([{ kind: 'storyboard', shotId: row.shotId }])}>Generate image now</Button>
          </div></details>
          <div className="production-board__shot-actions">
            <Button variant="primary" disabled={busy || saving || batchBusy || generationBlock !== null} onClick={() => void runVideoBatch(row.shotId)}>{row.candidateCount > 0 ? 'Regenerate this shot' : 'Generate this shot'}</Button>
            <Button variant="ghost" disabled={busy || saving || batchBusy} onClick={() => void onOpenShot(row.shotId)}>{row.state === 'needs_review' || row.state === 'needs_import' ? 'Review take & prompt' : 'Edit prompt & inputs'}</Button>
          </div>
          {generationBlock !== null && <p className="production-board__take-summary">{generationBlock}</p>}
        </li>; })}
      </ol>

      <details className="production-board__final-panel"><summary>Final cut <span>{dashboard.assemblyReady ? 'READY TO ASSEMBLE' : 'AWAITING APPROVED TAKES'}</span></summary>
      {!assembly.ok && <StatusCard tone="neutral">Assembly blocked: {assembly.reason}</StatusCard>}
      {assembly.ok && <StatusCard tone="neutral">Film sequence: {assembly.shots.length} shots · {(assembly.totalDurationMs / 1000).toFixed(1)}s in script order. Extra generated footage is trimmed without changing the original files; short takes must be replaced or the plan revised.</StatusCard>}
      <div className="production-board__actions">
        <Button variant="default" disabled={busy || saving || batchBusy || missingCharacterTargets.length === 0}
          onClick={() => void runImages(missingCharacterTargets)}>
          Generate missing character images
        </Button>
        <Button variant="ghost" onClick={onOpenImageResults}>Review image results</Button>
        <Button variant="primary" disabled={busy || saving || !assembly.ok} onClick={() => {
          const assembled = onAssemble();
          setMessage({ tone: assembled ? 'success' : 'warning', text: assembled
            ? `Placed ${rows.length} approved shots on the timeline in Writer order. Save and review the cut before export.`
            : 'The cut was not assembled. Check the Editing status for the exact conflict.' });
        }}>Assemble approved shots on timeline</Button>
        <span>Video results are saved automatically. Continuity approval, image-reference assignment, assembly and export remain explicit.</span>
      </div>
      </details>
      </>}
    </section>
  );
}
