import { useState, type ReactElement } from 'react';

import type { StatusMessage } from './appTypes';
import { AiDomainModelSelector } from './AiDomainModelSelector';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';

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
    <section className="narration-panel" aria-labelledby="narration-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">AI Voice Studio</p>
          <h2 id="narration-title">Voice Generation &amp; Synthesis</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AiDomainModelSelector domain="voice-generation" label="Voice model" />
          <span className="mode-badge mode-badge--api" role="status" aria-label="Voice execution mode">
            Cloud API · {voiceModel.providerLabel}
          </span>
        </div>
      </div>

      <div className="narration-grid">
        <section className="narration-card" aria-labelledby="voice-synthesis-title">
          <div>
            <p className="section-kicker">{voiceModel.providerLabel} API</p>
            <h3 id="voice-synthesis-title">Cloud Voice Synthesis · {voiceModel.label}</h3>
          </div>

          <label className="field-label">
            API key override (optional)
            <input
              type="password"
              value={apiKeyOverride}
              onChange={(event) => setApiKeyOverride(event.target.value)}
              placeholder="Leave empty to use the key connected in Settings → Providers"
              autoComplete="off"
            />
          </label>

          {isElevenLabs && (
            <label className="field-label">
              Voice
              <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                {ELEVENLABS_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            </label>
          )}

          <label className="field-label">
            Speech script
            <textarea
              rows={6}
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="Enter text to synthesize with the selected cloud voice model..."
            />
          </label>

          <div className="transport-strip__buttons">
            <button className="button button--primary" type="button" onClick={() => void generate()} disabled={isGenerating}>
              {isGenerating ? '⚡ Synthesizing...' : `⚡ Synthesize with ${voiceModel.providerLabel}`}
            </button>
          </div>

          {status !== null && (
            <div className={`status-card status-card--${status.tone}`} role="status" style={{ marginTop: 'var(--space-3)' }}>
              {status.text}
            </div>
          )}

          {completedJobId !== null && (
            <div className="transport-strip__buttons" style={{ marginTop: 'var(--space-3)' }}>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void importToProject()}
                disabled={projectImport.activeProject === null || projectImport.isImporting}
              >
                📥 Import to Project Timeline
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
