import { useEffect, useRef, useState } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { createUseProductionPlan } from '../../shared/useProductionPlan';
import { pipelineBaseRequest, pipelineMatchesBrief } from '../../shared/writerPipeline';
import { WRITER_MODEL_IDS, type WriterRequest } from '../../shared/writerWorkflow';
import { getLlmProvider } from '../../shared/llmProviders';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { DomainModelPicker } from './DomainModelPicker';
const useProductionPlan = createUseProductionPlan({ useEffect, useRef, useState });

export function ProductionPlanComposer({ document, onSave, disabled }: {
  document: AiProjectDocument; onSave: (document: AiProjectDocument) => Promise<boolean>; disabled: boolean;
}) {
  const base = pipelineBaseRequest(document.writerPipeline);
  const [brief, setBrief] = useState(base?.sourceText ?? '');
  const [seconds, setSeconds] = useState(String(base?.targetDurationSeconds ?? 60));
  const [language, setLanguage] = useState(base?.language ?? 'Korean');
  const { selectedModel } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const model = selectedModel('writer');
  const provider = getLlmProvider(model.providerId);
  const connected = provider?.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;
  const flow = useProductionPlan(document, onSave);
  const request: WriterRequest = { ...(base ?? { mode: 'idea_to_script', audience: 'General audience', tone: 'Cinematic and engaging' }), sourceText: brief.trim(), targetDurationSeconds: Number(seconds), language: language.trim() };
  const busy = disabled || flow.busy;
  const valid = !!request.sourceText && !!request.language && Number.isSafeInteger(request.targetDurationSeconds) && request.targetDurationSeconds >= 4 && request.targetDurationSeconds <= 7200;
  const matches = pipelineMatchesBrief(flow.proposal, request);
  const applied = !!document.writerPipeline?.appliedScriptId;
  return <section className="production-plan-composer" aria-label="Guided production">
    <header><p className="section-kicker">BRIEF → PLAN APPROVAL → GENERATE → REVIEW → ASSEMBLE</p><h2>What video should we make?</h2>
      <p>Describe the story once. Review the complete script, scenes and shot prompts before generating media.</p></header>
    <label className="studio-field"><span>Production brief</span><textarea rows={5} value={brief} disabled={busy} onChange={event => setBrief(event.target.value)} placeholder="A 60-second mystery with two characters, a rainy station and a surprising ending…" /></label>
    <div className="writer-workspace__row">
      <label className="studio-field"><span>Target seconds</span><input type="number" min={4} max={7200} value={seconds} disabled={busy} onChange={event => setSeconds(event.target.value)} /></label>
      <label className="studio-field"><span>Dialogue language</span><input value={language} disabled={busy} onChange={event => setLanguage(event.target.value)} /></label>
    </div>
    <DomainModelPicker domain="writer" ariaLabel="Production planner model" />
    <p>Planning uses your connected writing model and may incur text-model charges. Media generation has a separate cost confirmation.</p>
    <button className="button" disabled={busy || !valid || !connected} onClick={() => {
      if (!window.confirm('Generate a complete production plan using the selected writing model? Text-model charges may apply. This replaces the current planning draft, not existing media. No media generation will start.')) return;
      void flow.generate(request, model.id, async input => {
        if (!(WRITER_MODEL_IDS as readonly string[]).includes(model.id)) throw new Error('Select a supported writing model.');
        const result = await window.videoTool.generateWriterDraft({ modelId: model.id as (typeof WRITER_MODEL_IDS)[number], request: input });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      });
    }}>{flow.busy ? 'Working…' : flow.proposal ? 'Revise complete plan' : 'Propose complete plan'}</button>
    {!connected && <p>Connect the selected writing provider in Settings to propose a plan.</p>}
    {flow.proposal && <div className="production-plan-review">
      <h3>{applied && matches ? 'Approved production plan' : 'Review proposed plan'}</h3>
      {flow.proposal.artifacts.map(artifact => <details key={artifact.stage} open={artifact.stage === 'screenplay'}><summary>{artifact.stage} · {artifact.title}</summary><pre>{artifact.content}</pre></details>)}
      {!matches && <p role="alert">The brief changed. Generate a revised plan before approval.</p>}
      {flow.unsaved && <button className="button" disabled={busy} onClick={() => { if (window.confirm('Replace the saved planning draft with this retained proposal?')) void flow.saveDraft(); }}>Retry saving proposal</button>}
      <button className="button" disabled={busy || !matches || applied || flow.unsaved} onClick={() => {
        if (window.confirm('Approve the entire displayed brief, screenplay, scene breakdown and shot prompts? This prepares production shots. Generating media still requires cost approval.')) void flow.approve(request);
      }}>{applied ? 'Plan approved' : 'Approve plan & prepare shots'}</button>
    </div>}
    {flow.message && <p role="status">{flow.message}</p>}
  </section>;
}
