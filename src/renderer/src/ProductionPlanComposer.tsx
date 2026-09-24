import { useEffect, useRef, useState } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { createUseProductionPlan } from '../../shared/useProductionPlan';
import { pipelineBaseRequest, pipelineMatchesBrief } from '../../shared/writerPipeline';
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
  const [brief, setBrief] = useState(base?.sourceText ?? '');
  const [seconds, setSeconds] = useState(String(base?.targetDurationSeconds ?? 600));
  const [customLength, setCustomLength] = useState(![300, 600, 900].includes(base?.targetDurationSeconds ?? 600));
  const [language, setLanguage] = useState(base?.language ?? 'Korean');
  const { selectedModel } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const model = selectedModel('writer');
  const provider = getLlmProvider(model.providerId);
  const connected = provider?.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;
  const flow = useProductionPlan(document, onSave);
  const request: WriterRequest = { ...(base ?? { mode: 'idea_to_script', audience: 'General audience', tone: 'Cinematic and engaging', shotDurationSeconds: 5 as const }), sourceText: brief.trim(), targetDurationSeconds: Number(seconds), language: language.trim() };
  const busy = disabled || flow.busy;
  const valid = !!request.sourceText && !!request.language && Number.isSafeInteger(request.targetDurationSeconds) && request.targetDurationSeconds >= (request.shotDurationSeconds === 5 ? 300 : 4) && request.targetDurationSeconds <= (request.shotDurationSeconds === 5 ? 900 : 7200) && (request.shotDurationSeconds !== 5 || request.targetDurationSeconds % 5 === 0);
  const matches = pipelineMatchesBrief(flow.proposal, request);
  const applied = !!document.writerPipeline?.appliedScriptId;
  const checkpoint = nextProductionCheckpoint(flow.proposal);
  return <section id="production-plan" className="production-plan-composer" aria-label="Guided production">
    <header><p className="section-kicker">{applied ? 'PRODUCTION PLAN APPROVED' : flow.proposal ? 'REVIEW THE PROPOSED PLAN' : 'STEP 1 · STORY BRIEF'}</p><h2>{applied ? 'Screenplay and scene plan' : flow.proposal ? 'Review your film plan' : 'Start your film here'}</h2>
      <p>Describe your story. OpenScene will plan the scenes and five-second shots; you approve each step before video generation.</p>
      <details className="production-plan-composer__help"><summary>How the film is made</summary><ol className="production-plan-composer__steps"><li><strong>Write the brief</strong><span>Describe the story below.</span></li><li><strong>Propose a plan</strong><span>Use the selected writing model.</span></li><li><strong>Approve each step</strong><span>Review the screenplay, scenes and shot prompts.</span></li><li><strong>Make scene 1</strong><span>Return to the story reel to generate and review shots.</span></li></ol></details></header>
    <label className="studio-field"><span>Production brief</span><textarea id="production-brief" rows={5} value={brief} disabled={busy} onChange={event => setBrief(event.target.value)} placeholder="A ten-minute mystery: two characters cross paths at a rainy station, uncover a secret, and face a final choice…" /></label>
    <label className="studio-field"><span>Film length</span><select value={customLength ? 'custom' : seconds} disabled={busy} onChange={event => {
      if (event.target.value === 'custom') { setCustomLength(true); setSeconds(''); }
      else { setCustomLength(false); setSeconds(event.target.value); }
    }}><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="custom">Custom length</option></select></label>
    {customLength && <label className="studio-field"><span>Custom length · 300–900 seconds, in five-second steps</span><input type="number" min={300} max={900} step={5} value={seconds} disabled={busy} onChange={event => setSeconds(event.target.value)} /></label>}
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
    }}>{flow.busy ? 'Working…' : flow.proposal ? 'Revise screenplay and scene plan' : 'Create screenplay and scene plan'}</button>
    {!request.sourceText && <p>Start by writing a story brief above. No video is generated at this step.</p>}
    {!connected && <p>Connect the selected writing provider in Settings to create a plan.</p>}
    {flow.proposal && <div className="production-plan-review">
      <h3 id="production-plan-review" tabIndex={-1}>{applied && matches ? 'Approved production plan' : 'Review proposed plan'}</h3>
      <ol className="production-checkpoint-rail" aria-label="Plan checkpoints">{WRITER_STAGES.map(stage => <li key={stage} aria-current={checkpoint === stage ? 'step' : undefined}>{flow.proposal!.artifacts.some(item => item.stage === stage && item.approved) ? '✓ ' : ''}{WRITER_STAGE_LABELS[stage]}</li>)}</ol>
      {flow.proposal.artifacts.map(artifact => <details key={artifact.stage + ':' + checkpoint} open={artifact.stage === checkpoint}><summary>{WRITER_STAGE_LABELS[artifact.stage]} · {artifact.approved ? 'Approved' : 'Review required'}</summary><pre>{artifact.content}</pre><ul>{WRITER_STAGE_CHECKLISTS[artifact.stage].map(item => <li key={item}>{item}</li>)}</ul></details>)}
      {!matches && <p role="alert">The brief changed. Generate a revised plan before approval.</p>}
      {flow.unsaved && <button className="button" disabled={busy} onClick={() => { if (window.confirm('Replace the saved planning draft with this retained proposal?')) void flow.saveDraft(); }}>Retry saving proposal</button>}
      <button className="button" disabled={busy || !matches || applied || flow.unsaved || !checkpoint} onClick={() => {
        if (checkpoint && window.confirm(`Approve ${WRITER_STAGE_LABELS[checkpoint]}? ${checkpoint === 'prompts' ? 'This prepares the production shots. Media generation still requires cost approval.' : 'Only this checkpoint will be approved. Review the next stage separately.'}`)) void flow.approve(request, checkpoint);
      }}>{applied ? 'Plan approved' : checkpoint ? `Approve ${WRITER_STAGE_LABELS[checkpoint]}` : 'No checkpoint to approve'}</button>
    </div>}
    {flow.message && <p role="status">{flow.message}</p>}
  </section>;
}
