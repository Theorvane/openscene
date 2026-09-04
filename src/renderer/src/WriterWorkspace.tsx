import { useMemo, useState, type ReactElement } from 'react';

import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import {
  WRITER_MODEL_IDS,
  applyWriterDraft,
  writerDraftDurationSeconds,
  type WriterDraft,
  type WriterMode,
  type WriterRequest
} from '../../shared/writerWorkflow';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { DomainModelPicker } from './DomainModelPicker';
import { Button, StatusCard } from './ui';
import { getLlmProvider } from '../../shared/llmProviders';

type Preview = { readonly draft: WriterDraft; readonly request: WriterRequest };

export function WriterWorkspace({
  document,
  onSave
}: {
  readonly document: AiProjectDocument;
  readonly onSave: (document: AiProjectDocument) => Promise<boolean>;
}): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const model = selectedModel('writer');
  const [mode, setMode] = useState<WriterMode>('idea_to_script');
  const [sourceText, setSourceText] = useState('');
  const [language, setLanguage] = useState('Vietnamese');
  const [audience, setAudience] = useState('General audience');
  const [tone, setTone] = useState('Cinematic and engaging');
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(60);
  const [parentScriptId, setParentScriptId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success' | 'neutral'; text: string } | null>(null);

  const rewriteScripts = useMemo(
    () => document.scripts.filter((script) => script.status !== 'superseded').slice().reverse(),
    [document.scripts]
  );
  const selectedParent = document.scripts.find((script) => script.id === parentScriptId);
  const provider = getLlmProvider(model.providerId);
  const providerConnected = provider?.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;

  const generate = async (): Promise<void> => {
    if (!(WRITER_MODEL_IDS as readonly string[]).includes(model.id)) {
      setMessage({ tone: 'danger', text: 'The selected model is not available to Writer.' });
      return;
    }
    if (mode === 'rewrite' && selectedParent === undefined) {
      setMessage({ tone: 'danger', text: 'Choose the script version to rewrite.' });
      return;
    }
    const request: WriterRequest = {
      mode,
      sourceText: sourceText.trim(),
      language: language.trim(),
      audience: audience.trim(),
      tone: tone.trim(),
      targetDurationSeconds,
      ...(mode === 'rewrite' && selectedParent !== undefined
        ? { parentScriptId: selectedParent.id, currentScreenplay: selectedParent.screenplay }
        : {})
    };
    setBusy(true);
    setMessage(null);
    try {
      const response = await window.videoTool.generateWriterDraft({ modelId: model.id as (typeof WRITER_MODEL_IDS)[number], request });
      if (!response.ok) {
        setMessage({ tone: 'danger', text: response.error.message });
        return;
      }
      setPreview({ draft: response.value, request });
      setMessage({ tone: 'neutral', text: 'Draft generated. Review it before saving to the project.' });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : `${model.providerLabel} Writer failed.` });
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (preview === null) return;
    const applied = applyWriterDraft({
      document,
      request: preview.request,
      draft: preview.draft,
      createdAt: new Date().toISOString(),
      idPrefix: `writer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    });
    if (!applied.ok) {
      setMessage({ tone: 'danger', text: applied.message });
      return;
    }
    setBusy(true);
    try {
      const saved = await onSave(applied.document);
      if (!saved) {
        setMessage({ tone: 'danger', text: 'The Writer draft could not be saved.' });
        return;
      }
      setPreview(null);
      setMessage({ tone: 'success', text: `Saved “${preview.draft.title}” with ${preview.draft.scenes.length} scene(s).` });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The Writer draft could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const canGenerate = !busy && providerConnected && sourceText.trim().length > 0 &&
    language.trim().length > 0 && audience.trim().length > 0 && tone.trim().length > 0 &&
    (mode !== 'rewrite' || selectedParent !== undefined);

  return (
    <section className="ai-workspace writer-workspace" aria-labelledby="writer-workspace-title">
      <header className="ai-workspace__header">
        <div>
          <p className="section-kicker">{model.providerLabel} · structured project draft</p>
          <h2 id="writer-workspace-title">Writer & Storyboard</h2>
          <p className="ai-workspace__subtitle">Create or rewrite a script, then review its scenes and shots before it changes the project.</p>
        </div>
        <DomainModelPicker domain="writer" ariaLabel="Writer model" />
      </header>

      <div className="ai-workspace__grid">
        <div className="ai-workspace__form-panel studio-form">
          <label className="studio-field">
            <span className="studio-field__label">Task</span>
            <select value={mode} onChange={(event) => { setMode(event.target.value as WriterMode); setPreview(null); }}>
              <option value="idea_to_script">Idea → script</option>
              <option value="content_to_script">Content → script</option>
              <option value="rewrite">Rewrite a script</option>
            </select>
          </label>
          {mode === 'rewrite' && (
            <label className="studio-field">
              <span className="studio-field__label">Script version</span>
              <select value={parentScriptId} onChange={(event) => { setParentScriptId(event.target.value); setPreview(null); }}>
                <option value="">Choose a version</option>
                {rewriteScripts.map((script) => <option key={script.id} value={script.id}>{script.title}</option>)}
              </select>
            </label>
          )}
          <label className="studio-field">
            <span className="studio-field__label">{mode === 'rewrite' ? 'Rewrite instructions' : mode === 'content_to_script' ? 'Source content' : 'Idea'}</span>
            <textarea rows={9} value={sourceText} onChange={(event) => { setSourceText(event.target.value); setPreview(null); }} placeholder="Describe the video, paste source content, or explain what should change…" />
          </label>
          <div className="writer-workspace__row">
            <label className="studio-field"><span className="studio-field__label">Language</span><input value={language} onChange={(event) => setLanguage(event.target.value)} /></label>
            <label className="studio-field"><span className="studio-field__label">Duration (seconds)</span><input type="number" min={4} max={7200} value={targetDurationSeconds} onChange={(event) => setTargetDurationSeconds(Number(event.target.value))} /></label>
          </div>
          <label className="studio-field"><span className="studio-field__label">Audience</span><input value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
          <label className="studio-field"><span className="studio-field__label">Tone</span><input value={tone} onChange={(event) => setTone(event.target.value)} /></label>
          {!providerConnected && <StatusCard tone="warning">Connect {model.providerLabel} in Settings → Providers before generating.</StatusCard>}
          <Button variant="primary" disabled={!canGenerate} onClick={() => void generate()}>{busy ? 'Working…' : 'Generate draft'}</Button>
          {message !== null && <StatusCard tone={message.tone}>{message.text}</StatusCard>}
        </div>

        <div className="ai-workspace__results-panel writer-preview" aria-live="polite">
          <h3>Review before save</h3>
          {preview === null ? (
            <p className="studio-reference__empty">No unsaved Writer draft.</p>
          ) : (
            <>
              <div className="writer-preview__summary">
                <strong>{preview.draft.title}</strong>
                <span>{preview.draft.scenes.length} scenes · {preview.draft.scenes.reduce((n, scene) => n + scene.shots.length, 0)} shots · {writerDraftDurationSeconds(preview.draft)}s</span>
              </div>
              <pre className="writer-preview__screenplay">{preview.draft.screenplay}</pre>
              <div className="writer-preview__scenes">
                {preview.draft.scenes.map((scene, index) => (
                  <article key={`${index}-${scene.title}`} className="writer-preview__scene">
                    <strong>{index + 1}. {scene.title}</strong>
                    <span>{scene.setting}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''}</span>
                    <p>{scene.objective}</p>
                    <small>{scene.shots.length} shot(s) · {scene.shots.reduce((n, shot) => n + shot.durationSeconds, 0)}s</small>
                  </article>
                ))}
              </div>
              <div className="writer-preview__actions">
                <Button disabled={busy} onClick={() => setPreview(null)}>Discard</Button>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save to project'}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
