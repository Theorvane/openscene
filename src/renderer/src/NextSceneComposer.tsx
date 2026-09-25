import { useState } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { approveNextSequentialScene, buildNextSequentialSceneRequest, discardNextSequentialScene, proposeNextSequentialScene } from '../../shared/sequentialProduction';
import { parseWriterPromptText } from '../../shared/writerPipeline';
import { WRITER_MODEL_IDS } from '../../shared/writerWorkflow';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { getLlmProvider } from '../../shared/llmProviders';
import { DomainModelPicker } from './DomainModelPicker';

export function NextSceneComposer({ document, onSave, disabled }: {
  document: AiProjectDocument;
  onSave: (next: AiProjectDocument) => Promise<boolean>;
  disabled: boolean;
}) {
  const [brief, setBrief] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unsaved, setUnsaved] = useState<AiProjectDocument | null>(null);
  const { selectedModel } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const model = selectedModel('writer');
  const provider = getLlmProvider(model.providerId);
  const connected = provider?.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;
  const pending = document.pendingSequentialScene;
  const draft = pending ? parseWriterPromptText(pending.draftJson) : null;
  const sceneCount = document.scenes.filter(item => item.scriptVersionId === document.writerPipeline?.appliedScriptId).length;
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await job(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update the scene plan.'); }
    finally { setBusy(false); }
  };
  return <section className="next-scene-composer" aria-label="Next scene">
    <p className="section-kicker">SCENE {sceneCount} COMPLETE</p>
    <h2>What happens in scene {sceneCount + 1}?</h2>
    <p>Plan only the next scene. Its five-second shots join the film after you approve them. Existing character identities and visual style stay locked. You can also assemble the approved scenes now.</p>
    {!pending && <>
      <label className="studio-field"><span>Next scene brief</span><textarea value={brief} onChange={event => setBrief(event.target.value)} rows={3} disabled={busy || disabled} placeholder="What changes in this scene? Where are the characters at its end?" /></label>
      <label className="studio-field"><span>Scene length</span><select value={seconds} disabled={busy || disabled} onChange={event => setSeconds(Number(event.target.value))}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option></select></label>
      <DomainModelPicker domain="writer" ariaLabel="Next scene writing model" />
      <button className="button" disabled={busy || disabled || !connected || !brief.trim()} onClick={() => {
        if (!window.confirm('Plan the next scene with the selected writing model? Text-model charges may apply. No video starts.')) return;
        void run(async () => {
          const request = buildNextSequentialSceneRequest(document, brief, seconds);
          if (!(WRITER_MODEL_IDS as readonly string[]).includes(model.id)) throw new Error('Select a supported writing model.');
          const result = await window.videoTool.generateWriterDraft({ modelId: model.id as (typeof WRITER_MODEL_IDS)[number], request });
          if (!result.ok) throw new Error(result.error.message);
          const next = proposeNextSequentialScene(document, request, result.value, model.id);
          setUnsaved(next);
          if (!await onSave(next)) throw new Error('The proposed scene was generated but could not be saved. Retry saving below.');
          setUnsaved(null);
          setMessage('Scene proposal saved. Review the screenplay and every shot before approval.');
        });
      }}>Plan scene {sceneCount + 1}</button>
    </>}
    {unsaved && <button className="button" disabled={busy || disabled} onClick={() => { void run(async () => { if (!await onSave(unsaved)) throw new Error('Could not save the proposed scene.'); setUnsaved(null); }); }}>Retry saving proposed scene</button>}
    {pending && <div className="next-scene-composer__review">
      <h3>Review scene {sceneCount + 1}: {draft?.scenes[0]?.title ?? 'Invalid proposal'}</h3>
      <p>{draft?.screenplay}</p>
      <ol>{draft?.scenes[0]?.shots.map((shot, index) => <li key={index}><strong>Shot {index + 1} · 5 seconds</strong><span>{shot.action}</span></li>)}</ol>
      <div className="production-board__actions">
        <button className="button" disabled={busy || disabled || !draft} onClick={() => {
          if (!window.confirm('Add this scene to the film? Earlier approved takes stay attached to their shots.')) return;
          void run(async () => {
            const next = approveNextSequentialScene(document, new Date().toISOString(), 'scene-' + Date.now().toString(36));
            if (!await onSave(next)) throw new Error('The approved scene could not be saved. Retry approval.');
            setBrief('');
            setMessage('Scene added. Review and approve it before video generation.');
          });
        }}>Approve and add scene</button>
        <button className="button" disabled={busy || disabled} onClick={() => {
          if (!window.confirm('Discard this next-scene proposal? Existing scenes and takes stay saved.')) return;
          void run(async () => { if (!await onSave(discardNextSequentialScene(document))) throw new Error('Could not discard the proposal.'); });
        }}>Discard proposal</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
