import { useState, type ReactElement } from 'react';

import type { StatusMessage } from './appTypes';
import { AiDomainModelSelector } from './AiDomainModelSelector';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

const ELEVENLABS_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (Calm & Professional)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (Energetic)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (Expressive)' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni (Deep Narrative)' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (Clear Executive)' }
] as const;

/**
 * Voice generation runs entirely against connected provider APIs — the model
 * selected here decides which one. Ollama is the app's only local engine and
 * serves the Edit Agent, not speech synthesis.
 */
export function NarrationPanel(): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const voiceModel = selectedModel('voice-generation');
  const projectImport = useProjectResultImport();
  const isElevenLabs = voiceModel.providerId === 'elevenlabs';

  const [apiKeyOverride, setApiKeyOverride] = useState('');
  const [voiceId, setVoiceId] = useState<string>(ELEVENLABS_VOICES[0].id);
  const [script, setScript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);

  const generate = async (): Promise<void> => {
    if (script.trim().length === 0) {
      setStatus({ tone: 'danger', text: `Please enter a narration script for ${voiceModel.providerLabel}.` });
      return;
    }

    setIsGenerating(true);
    setCompletedJobId(null);
    setStatus({ tone: 'neutral', text: `Synthesizing voice with the ${voiceModel.providerLabel} API...` });

    try {
      const response = await window.videoTool.aiGenerateSpeech({
        script,
        voiceId: isElevenLabs ? voiceId : '',
        modelId: voiceModel.id,
        ...(apiKeyOverride.trim().length > 0 ? { apiKey: apiKeyOverride.trim() } : {})
      });

      if (!response.ok) {
        setIsGenerating(false);
        setStatus({ tone: 'danger', text: response.error.message });
        return;
      }

      const job = response.value;
      setStatus({ tone: 'neutral', text: `Synthesizing audio… Job ID ${job.id}` });

      const intervalId = setInterval(async () => {
        const poll = await window.videoTool.aiGetSpeechJob(job.id);
        if (!poll.ok) return;
        const updated = poll.value;
        if (updated.status === 'completed') {
          clearInterval(intervalId);
          setIsGenerating(false);
          setCompletedJobId(updated.id);
          setStatus({ tone: 'success', text: `${voiceModel.providerLabel} speech synthesis completed.` });
        } else if (updated.status === 'failed') {
          clearInterval(intervalId);
          setIsGenerating(false);
          setStatus({ tone: 'danger', text: updated.error ?? 'Speech synthesis failed.' });
        }
      }, 1000);
    } catch (error) {
      setIsGenerating(false);
      setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Speech synthesis error.' });
    }
  };

  const importToProject = async (): Promise<void> => {
    if (completedJobId === null) return;
    setStatus(await projectImport.importAiResult(completedJobId));
  };

  return (
    <section className="studio-surface" aria-labelledby="narration-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="narration-title">Voice Generation</h2>
          <span className="studio-surface__title-meta">
            {voiceModel.label} · {voiceModel.providerLabel} · Cloud API
          </span>
        </div>
        <AiDomainModelSelector domain="voice-generation" label="Voice model" />
      </header>

      <div className="studio-surface__body">
        {isElevenLabs && (
          <label className="studio-field">
            <span className="studio-field__label">Voice</span>
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
              {ELEVENLABS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="studio-field">
          <span className="studio-field__label">API key override</span>
          <input
            type="password"
            value={apiKeyOverride}
            onChange={(event) => setApiKeyOverride(event.target.value)}
            placeholder="Optional — defaults to the key connected in Settings"
            autoComplete="off"
          />
        </label>

        {status !== null && <StatusCard tone={status.tone}>{status.text}</StatusCard>}

        {completedJobId !== null && (
          <div className="studio-result">
            <span className="studio-result__label">Synthesis ready</span>
            <Button
              variant="primary"
              onClick={() => void importToProject()}
              disabled={projectImport.activeProject === null || projectImport.isImporting}
            >
              Import to project
            </Button>
          </div>
        )}
      </div>

      {/* Composer mirrors the chat prompt card: write, then act. */}
      <div className="studio-composer">
        <textarea
          className="studio-composer__input"
          rows={3}
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder="Write the narration script…"
          aria-label="Speech script"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">{voiceModel.providerLabel}</span>
          <Button variant="primary" onClick={() => void generate()} disabled={isGenerating || script.trim().length === 0}>
            {isGenerating ? 'Synthesizing…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
