import { useEffect, useRef, useState } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { createUseProductionPlan } from '../../shared/useProductionPlan';
import { pipelineBaseRequest, pipelineMatchesBrief, parseWriterPromptText } from '../../shared/writerPipeline';
import { WRITER_MODEL_IDS, type WriterRequest } from '../../shared/writerWorkflow';
import { getLlmProvider } from '../../shared/llmProviders';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { DomainModelPicker } from './DomainModelPicker';
import { nextProductionCheckpoint } from '../../shared/productionPlan';
import { WRITER_STAGES, WRITER_STAGE_LABELS, WRITER_STAGE_CHECKLISTS } from '../../shared/writerStages';
const useProductionPlan = createUseProductionPlan({ useEffect, useRef, useState });

export function ProductionPlanComposer({ document, onSave, disabled }: {
  document: AiProjectDocument; onSave: (document: AiProjectDocument) => Promise<boolean>; disabled: boolean;
}) {
  const base = pipelineBaseRequest(document.writerPipeline);
  const [mode, setMode] = useState<'film' | 'scene'>(base?.productionScope === 'scene' ? 'scene' : 'film');
  const [brief, setBrief] = useState(base?.sourceText ?? '');
  const [seconds, setSeconds] = useState(String(base?.targetDurationSeconds ?? 600));
  const [customLength, setCustomLength] = useState(!(base?.productionScope === 'scene' ? [15, 30, 60] : [300, 600, 900]).includes(base?.targetDurationSeconds ?? 600));
  const [language, setLanguage] = useState(base?.language ?? 'Korean');
  const { selectedModel } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const model = selectedModel('writer');
  const provider = getLlmProvider(model.providerId);
  const connected = provider?.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;
  const flow = useProductionPlan(document, onSave);
  const request: WriterRequest = { ...(base ?? { mode: 'idea_to_script', audience: 'General audience', tone: 'Cinematic and engaging', shotDurationSeconds: 5 as const }), ...(mode === 'scene' ? { productionScope: 'scene' as const } : {}), sourceText: brief.trim(), targetDurationSeconds: Number(seconds), language: language.trim() };
  const busy = disabled || flow.busy;
  const valid = !!request.sourceText && !!request.language && Number.isSafeInteger(request.targetDurationSeconds) && request.targetDurationSeconds >= (mode === 'scene' ? 5 : request.shotDurationSeconds === 5 ? 300 : 4) && request.targetDurationSeconds <= (mode === 'scene' ? 180 : request.shotDurationSeconds === 5 ? 900 : 7200) && (request.shotDurationSeconds !== 5 || request.targetDurationSeconds % 5 === 0);
  const matches = pipelineMatchesBrief(flow.proposal, request);
  const applied = !!document.writerPipeline?.appliedScriptId;
  const checkpoint = nextProductionCheckpoint(flow.proposal);
  const sceneDraft = mode === 'scene' ? parseWriterPromptText(flow.proposal?.artifacts.find(item => item.stage === 'prompts')?.content ?? '') : null;
  return <section id="production-plan" className="production-plan-composer" aria-label="Guided production">
    <header><p className="section-kicker">{applied ? 'PRODUCTION PLAN APPROVED' : flow.proposal ? 'REVIEW THE PROPOSED PLAN' : 'STEP 1 · STORY BRIEF'}</p><h2>{applied ? 'Screenplay and scene plan' : flow.proposal ? mode === 'scene' ? 'Review your first scene' : 'Review your film plan' : 'Start your film here'}</h2>
      <p>{mode === 'scene' ? 'Plan and make the current scene. After its shots are approved, plan the next scene or assemble the film.' : 'Plan the full story and five-second shots first, then make each scene in order.'}</p>
      <details className="production-plan-composer__help"><summary>How the film is made</summary><ol className="production-plan-composer__steps"><li><strong>Write the brief</strong><span>Describe the story below.</span></li><li><strong>Propose a plan</strong><span>Use the selected writing model.</span></li><li><strong>Approve each step</strong><span>Review the screenplay, scenes and shot prompts.</span></li><li><strong>Make scene 1</strong><span>Return to the story reel to generate and review shots.</span></li></ol></details></header>
    {!flow.proposal && <div className="production-plan-composer__modes" role="group" aria-label="Creation mode">
      <button type="button" className={mode === 'film' ? 'production-plan-composer__mode is-selected' : 'production-plan-composer__mode'} aria-pressed={mode === 'film'} onClick={() => { setMode('film'); setSeconds('600'); setCustomLength(false); }}><strong>Plan the whole film</strong><span>Set the story and all scenes before generating shots.</span></button>
      <button type="button" className={mode === 'scene' ? 'production-plan-composer__mode is-selected' : 'production-plan-composer__mode'} aria-pressed={mode === 'scene'} onClick={() => { setMode('scene'); setSeconds('30'); setCustomLength(false); }}><strong>Build scene by scene</strong><span>Make one scene, then decide what happens next.</span></button>
    </div>}
    <label className="studio-field"><span>Production brief</span><textarea id="production-brief" rows={5} value={brief} disabled={busy} onChange={event => setBrief(event.target.value)} placeholder={mode === 'scene' ? 'At a rainy station, a traveler finds a letter that changes the next choice…' : 'A ten-minute mystery: two characters cross paths at a rainy station, uncover a secret, and face a final choice…'} /></label>
    <label className="studio-field"><span>{mode === 'scene' ? 'First scene length' : 'Film length'}</span><select value={customLength ? 'custom' : seconds} disabled={busy} onChange={event => {
      if (event.target.value === 'custom') { setCustomLength(true); setSeconds(''); }
      else { setCustomLength(false); setSeconds(event.target.value); }
    }}>{mode === 'scene' ? <><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option></> : <><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option></>}<option value="custom">Custom length</option></select></label>
    {customLength && <label className="studio-field"><span>{mode === 'scene' ? 'Custom scene length · 5–180 seconds' : 'Custom film length · 300–900 seconds'}, in five-second steps</span><input type="number" min={mode === 'scene' ? 5 : 300} max={mode === 'scene' ? 180 : 900} step={5} value={seconds} disabled={busy} onChange={event => setSeconds(event.target.value)} /></label>}
    <details className="production-plan-composer__help"><summary>Dialogue language</summary>
      <label className="studio-field"><span>Dialogue language</span><input value={language} disabled={busy} onChange={event => setLanguage(event.target.value)} /></label>
    </details>
    <DomainModelPicker domain="writer" ariaLabel="Production planner model" />
    <small>Planning may use paid text-model credits. Video generation asks separately.</small>
    <button className="button" disabled={busy || !valid || !connected} onClick={() => {
      if (!window.confirm('Generate a complete production plan using the selected writing model? Text-model charges may apply. This replaces the current planning draft, not existing media. No media generation will start.')) return;
      void flow.generate(request, model.id, async input => {
        if (!(WRITER_MODEL_IDS as readonly string[]).includes(model.id)) throw new Error('Select a supported writing model.');
        const result = await window.videoTool.generateWriterDraft({ modelId: model.id as (typeof WRITER_MODEL_IDS)[number], request: input });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      });
    }}>{flow.busy ? 'Working…' : flow.proposal ? mode === 'scene' ? 'Regenerate first scene plan' : 'Revise screenplay and scene plan' : mode === 'scene' ? 'Plan first scene' : 'Create screenplay and scene plan'}</button>
    {!request.sourceText && <p>Start by writing a story brief above. No video is generated at this step.</p>}
    {!connected && <p>Connect the selected writing provider in Settings to create a plan.</p>}
    {flow.proposal && <div className="production-plan-review">
      <h3 id="production-plan-review" tabIndex={-1}>{applied && matches ? 'Approved production plan' : 'Review proposed plan'}</h3>
      {mode === 'scene' ? <div className="next-scene-composer__review"><h4>{sceneDraft?.scenes[0]?.title ?? 'Review the first scene'}</h4><p>{sceneDraft?.screenplay}</p><ol>{sceneDraft?.scenes[0]?.shots.map((shot, index) => <li key={index}><strong>Shot {index + 1} · 5 seconds</strong><span>{shot.action}</span></li>)}</ol></div> : <>
      <ol className="production-checkpoint-rail" aria-label="Plan checkpoints">{WRITER_STAGES.map(stage => <li key={stage} aria-current={checkpoint === stage ? 'step' : undefined}>{flow.proposal!.artifacts.some(item => item.stage === stage && item.approved) ? '✓ ' : ''}{WRITER_STAGE_LABELS[stage]}</li>)}</ol>
      {flow.proposal.artifacts.map(artifact => <details key={artifact.stage + ':' + checkpoint} open={artifact.stage === checkpoint}><summary>{WRITER_STAGE_LABELS[artifact.stage]} · {artifact.approved ? 'Approved' : 'Review required'}</summary><pre>{artifact.content}</pre><ul>{WRITER_STAGE_CHECKLISTS[artifact.stage].map(item => <li key={item}>{item}</li>)}</ul></details>)}
      </>}
      {!matches && <p role="alert">The brief changed. Generate a revised plan before approval.</p>}
      {flow.unsaved && <button className="button" disabled={busy} onClick={() => { if (window.confirm('Replace the saved planning draft with this retained proposal?')) void flow.saveDraft(); }}>Retry saving proposal</button>}
      {mode === 'scene' ? <button className="button" disabled={busy || !matches || applied || flow.unsaved || !sceneDraft} onClick={() => {
        if (window.confirm('Approve the first scene and its five-second shot prompts? Video generation still asks for cost approval.')) void flow.approveAll(request);
      }}>{applied ? 'First scene approved' : 'Approve first scene plan'}</button> : <button className="button" disabled={busy || !matches || applied || flow.unsaved || !checkpoint} onClick={() => {
        if (checkpoint && window.confirm(`Approve ${WRITER_STAGE_LABELS[checkpoint]}? ${checkpoint === 'prompts' ? 'This prepares the production shots. Media generation still requires cost approval.' : 'Only this checkpoint will be approved. Review the next stage separately.'}`)) void flow.approve(request, checkpoint);
      }}>{applied ? 'Plan approved' : checkpoint ? `Approve ${WRITER_STAGE_LABELS[checkpoint]}` : 'No checkpoint to approve'}</button>}
    </div>}
    {flow.message && <p role="status">{flow.message}</p>}
  </section>;
}
