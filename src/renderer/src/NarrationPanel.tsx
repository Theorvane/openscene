import { useState, type ChangeEvent, type ReactElement } from 'react';

import { ALLOWED_AUDIO_MIME_TYPES } from '../../shared/models';
import type { StatusMessage } from './appTypes';
import { formatDuration } from './format';
import { NARRATION_SAMPLE_LIMITS } from './narrationLogic';
import { parseAllowedAudioMimeType } from './narrationLogic';
import { useProjectResultImport } from './ProjectResultImportContext';
import { useNarration } from './useNarration';

export function NarrationPanel(): ReactElement {
  const narration = useNarration();
  const projectImport = useProjectResultImport();
  const [importStatus, setImportStatus] = useState<StatusMessage | null>(null);
  const [mode, setMode] = useState<'local' | 'api'>('local');
  const [elevenApiKey, setElevenApiKey] = useState('');
  const [elevenVoiceId, setElevenVoiceId] = useState('21m00Tcm4TlvDq8ikWAM'); // Default Rachel
  const [elevenScript, setElevenScript] = useState('');
  const [isGeneratingEleven, setIsGeneratingEleven] = useState(false);
  const [elevenStatus, setElevenStatus] = useState<StatusMessage | null>(null);
  const [elevenJob, setElevenJob] = useState<{ id: string; filePath?: string | undefined } | null>(null);

  const onProfileChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    narration.setSelectedProfileId(event.target.value);
  };

  const onMimeTypeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const mimeType = parseAllowedAudioMimeType(event.target.value);
    if (mimeType !== null) {
      narration.setTtsMimeType(mimeType);
    }
  };

  const completedTtsJob = narration.ttsJob?.state.kind === 'completed' ? narration.ttsJob : null;

  const importTtsResult = async (): Promise<void> => {
    if (completedTtsJob === null) return;
    setImportStatus({ tone: 'neutral', text: 'Importing narration into the active project.' });
    setImportStatus(await projectImport.importTtsResult(completedTtsJob.id));
  };

  const handleElevenGenerate = async (): Promise<void> => {
    if (elevenScript.trim().length === 0) {
      setElevenStatus({ tone: 'danger', text: 'Please enter a narration script for ElevenLabs.' });
      return;
    }
    if (elevenApiKey.trim().length === 0) {
      setElevenStatus({ tone: 'danger', text: 'Please enter your ElevenLabs API key.' });
      return;
    }

    setIsGeneratingEleven(true);
    setElevenStatus({ tone: 'neutral', text: 'Synthesizing voice with ElevenLabs API...' });

    try {
      const response = await window.videoTool.aiGenerateSpeech({
        script: elevenScript,
        voiceId: elevenVoiceId,
        mode: 'api',
        apiKey: elevenApiKey
      });

      if (response.ok && response.value) {
        const job = response.value as { id: string; status: string; outputFilePath?: string };
        setElevenStatus({ tone: 'neutral', text: `Synthesizing audio... Job ID ${job.id}` });

        const intervalId = setInterval(async () => {
          const poll = await window.videoTool.aiGetSpeechJob(job.id);
          if (poll.ok && poll.value) {
            const updated = poll.value as { id: string; status: string; outputFilePath?: string; error?: string };
            if (updated.status === 'completed') {
              clearInterval(intervalId);
              setIsGeneratingEleven(false);
              setElevenJob({ id: updated.id, filePath: updated.outputFilePath ?? undefined });
              setElevenStatus({ tone: 'success', text: 'ElevenLabs speech synthesis completed!' });
            } else if (updated.status === 'failed') {
              clearInterval(intervalId);
              setIsGeneratingEleven(false);
              setElevenStatus({ tone: 'danger', text: `ElevenLabs failed: ${updated.error ?? 'Error'}` });
            }
          }
        }, 1000);
      } else {
        setIsGeneratingEleven(false);
        setElevenStatus({ tone: 'danger', text: !response.ok ? response.error.message : 'Failed to start ElevenLabs job.' });
      }
    } catch (err) {
      setIsGeneratingEleven(false);
      setElevenStatus({ tone: 'danger', text: err instanceof Error ? err.message : 'ElevenLabs synthesis error.' });
    }
  };

  const handleImportElevenToProject = async (): Promise<void> => {
    if (!elevenJob) return;
    try {
      const status = await projectImport.importTtsResult(elevenJob.id);
      setElevenStatus(status);
    } catch (err) {
      setElevenStatus({ tone: 'danger', text: err instanceof Error ? err.message : 'Import failed.' });
    }
  };

  return (
    <section className="narration-panel" aria-labelledby="narration-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">AI Voice Studio</p>
          <h2 id="narration-title">Voice Generation & Synthesis</h2>
        </div>
        <div className="mode-toggle-group" role="radiogroup" aria-label="Voice execution mode selection">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'local'}
            className={`mode-toggle-btn ${mode === 'local' ? 'mode-toggle-btn--active' : ''}`}
            onClick={() => setMode('local')}
          >
            <span className="mode-badge mode-badge--local">Local</span>
            <span>Local Qwen</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'api'}
            className={`mode-toggle-btn ${mode === 'api' ? 'mode-toggle-btn--active' : ''}`}
            onClick={() => setMode('api')}
          >
            <span className="mode-badge mode-badge--api">Cloud API</span>
            <span>ElevenLabs API</span>
          </button>
        </div>
      </div>

      {mode === 'local' ? (
        <div className="narration-grid">
          <section className="narration-card" aria-labelledby="voice-profile-title">
            <div>
              <p className="section-kicker">Reference sample</p>
              <h3 id="voice-profile-title">Create profile</h3>
            </div>
            <label className="field-label">
              Display name
              <input value={narration.displayName} onChange={(event) => narration.setDisplayName(event.target.value)} placeholder="My narration voice" />
            </label>
            <label className="field-label">
              Language
              <input value={narration.language} onChange={(event) => narration.setLanguage(event.target.value)} placeholder="en-US" />
            </label>
            <label className="field-label">
              Sample script
              <textarea value={narration.narrationScript} onChange={(event) => narration.setNarrationScript(event.target.value)} rows={4} />
            </label>
            <label className="consent-row">
              <input type="checkbox" checked={narration.explicitConsent} onChange={(event) => narration.setExplicitConsent(event.target.checked)} />
              <span>I have permission to store this voice sample locally and use it for local narration generation.</span>
            </label>
            <div className="sample-meter">
              <span>Sample length</span>
              <strong>{formatDuration(narration.sampleDurationMs)}</strong>
              <small>Save requires {formatDuration(NARRATION_SAMPLE_LIMITS.minimumDurationMs)} to {formatDuration(NARRATION_SAMPLE_LIMITS.maximumDurationMs)}.</small>
            </div>
            <div className="transport-strip__buttons">
              <button className="button button--record" type="button" onClick={() => void narration.startSampleRecording()} disabled={!narration.canStartSample}>Start mic sample</button>
              <button className="button button--stop" type="button" onClick={narration.stopSampleRecording} disabled={narration.sampleState !== 'recording'}>Stop sample</button>
              <button className="button button--primary" type="button" onClick={() => void narration.saveSample()} disabled={!narration.canSaveSample}>Save profile</button>
              <button className="button button--ghost" type="button" onClick={() => void narration.discardSample()} disabled={narration.sampleState === 'idle'}>Discard sample</button>
            </div>
          </section>

          <section className="narration-card" aria-labelledby="tts-title">
            <div>
              <p className="section-kicker">Local Qwen</p>
              <h3 id="tts-title">Generate audio</h3>
            </div>
            <div className={`runtime-card runtime-card--${narration.runtimeStatus?.kind ?? 'checking'}`} role="status">
              {narration.runtimeText}
            </div>
            <label className="field-label">
              Voice profile
              <select value={narration.selectedProfileId} onChange={onProfileChange}>
                <option value="">Select a saved profile</option>
                {narration.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.displayName} ({profile.language})</option>
                ))}
              </select>
            </label>
            {narration.selectedProfile !== null && (
              <dl className="profile-meta">
                <div><dt>Samples</dt><dd>{narration.selectedProfile.sampleCount}</dd></div>
                <div><dt>Total sample</dt><dd>{formatDuration(narration.selectedProfile.totalDurationMs)}</dd></div>
              </dl>
            )}
            <label className="field-label">
              Output format
              <select value={narration.ttsMimeType} onChange={onMimeTypeChange}>
                {ALLOWED_AUDIO_MIME_TYPES.map((mimeType) => <option key={mimeType} value={mimeType}>{mimeType}</option>)}
              </select>
            </label>
            <label className="field-label">
              Narration script
              <textarea value={narration.ttsScript} onChange={(event) => narration.setTtsScript(event.target.value)} rows={5} placeholder="Type the narration to synthesize with the selected voice profile." />
            </label>
            <div className="transport-strip__buttons">
              <button className="button button--primary" type="button" onClick={() => void narration.startTtsJob()} disabled={!narration.canGenerateTts}>Generate TTS</button>
              <button className="button button--ghost" type="button" onClick={() => void narration.deleteSelectedProfile()} disabled={narration.selectedProfile === null}>Delete profile</button>
            </div>
            <div className="runtime-card" role="status">{narration.ttsJobText}</div>
            {completedTtsJob !== null && (
              <>
                <div className="transport-strip__buttons">
                  <button className="button button--primary" type="button" onClick={() => void importTtsResult()} disabled={projectImport.activeProject === null || projectImport.isImporting} aria-label="Import completed narration audio into the active timeline project">Import to project</button>
                  <button className="button" type="button" onClick={() => void window.videoTool.openTtsResult({ jobId: completedTtsJob.id })}>Open audio</button>
                  <button className="button" type="button" onClick={() => void window.videoTool.revealTtsResult({ jobId: completedTtsJob.id })}>Reveal audio</button>
                </div>
                {importStatus !== null && <div className={`status-card status-card--${importStatus.tone}`} role="status" aria-live="polite">{importStatus.text}</div>}
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="narration-grid">
          <section className="narration-card" aria-labelledby="elevenlabs-title">
            <div>
              <p className="section-kicker">ElevenLabs API</p>
              <h3 id="elevenlabs-title">Cloud Voice Synthesis</h3>
            </div>
            <label className="field-label">
              ElevenLabs API Key
              <input
                type="password"
                value={elevenApiKey}
                onChange={(e) => setElevenApiKey(e.target.value)}
                placeholder="Enter ElevenLabs API Key (e.g. xi-api-key)..."
              />
            </label>

            <label className="field-label">
              Voice Model
              <select value={elevenVoiceId} onChange={(e) => setElevenVoiceId(e.target.value)}>
                <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Calm & Professional)</option>
                <option value="AZnzlk1XvdvUeBnXmlld">Domi (Energetic)</option>
                <option value="EXAVITQu4vr4xnSDxMaL">Bella (Expressive)</option>
                <option value="ErXwobaYiN019PkySvjV">Antoni (Deep Narrative)</option>
                <option value="pNInz6obpgDQGcFmaJgB">Adam (Clear Executive)</option>
              </select>
            </label>

            <label className="field-label">
              Speech Script
              <textarea
                rows={6}
                value={elevenScript}
                onChange={(e) => setElevenScript(e.target.value)}
                placeholder="Enter text to synthesize with ElevenLabs high-definition neural voice..."
              />
            </label>

            <div className="transport-strip__buttons">
              <button
                className="button button--primary"
                type="button"
                onClick={() => void handleElevenGenerate()}
                disabled={isGeneratingEleven}
              >
                {isGeneratingEleven ? '⚡ Synthesizing...' : '⚡ Synthesize with ElevenLabs'}
              </button>
            </div>

            {elevenStatus !== null && (
              <div className={`status-card status-card--${elevenStatus.tone}`} role="status" style={{ marginTop: 'var(--space-3)' }}>
                {elevenStatus.text}
              </div>
            )}

            {elevenJob?.filePath && (
              <div className="transport-strip__buttons" style={{ marginTop: 'var(--space-3)' }}>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void handleImportElevenToProject()}
                  disabled={projectImport.activeProject === null || projectImport.isImporting}
                >
                  📥 Import to Project Timeline
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      <div className={`status-card status-card--${narration.statusMessage.tone}`} role="status" style={{ marginTop: 'var(--space-4)' }}>
        {narration.statusMessage.text}
      </div>
    </section>
  );
}
