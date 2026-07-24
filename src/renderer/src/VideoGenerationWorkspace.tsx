import { useState, type ReactElement } from 'react';
import type { ProviderExecutionMode, VideoGenerationJob } from '../../shared/providerSeams';
import { LlmModelSelectorBar } from './LlmModelSelectorBar';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
const DURATIONS = [3, 5, 10] as const;

export function VideoGenerationWorkspace(): ReactElement {
  const { importTtsResult } = useProjectResultImport();
  const [mode, setMode] = useState<ProviderExecutionMode>('local');
  const [apiProvider, setApiProvider] = useState<'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream'>('gemini_veo');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [selectedStyle, setSelectedStyle] = useState<string>('Cinematic');
  const [apiKey, setApiKey] = useState('');
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }>({
    text: 'Ready to generate AI video. Choose Local or External API mode.',
    tone: 'neutral'
  });

  const handleGenerate = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return;
    }

    if (mode === 'api' && apiKey.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a valid API key for external generation.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatusMsg({
      text: `Submitting ${mode === 'local' ? 'Local AI Engine' : apiProvider === 'gemini_veo' ? 'Gemini Veo' : 'OpenAI Sora'} job...`,
      tone: 'neutral'
    });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt,
        aspectRatio,
        durationSeconds,
        stylePreset: selectedStyle,
        mode,
        provider: apiProvider,
        apiKey
      });

      if (response.ok && response.value) {
        const job = response.value as VideoGenerationJob;
        setJobs((prev) => [job, ...prev]);
        setStatusMsg({ text: `Job started (${job.id}). Synthesizing video frames...`, tone: 'neutral' });

        // Poll for job completion
        const intervalId = setInterval(async () => {
          const pollRes = await window.videoTool.aiGetVideoJob(job.id);
          if (pollRes.ok && pollRes.value) {
            const updatedJob = pollRes.value as VideoGenerationJob;
            setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));

            if (updatedJob.status === 'completed') {
              clearInterval(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: `Video generation completed! Asset ready.`, tone: 'success' });
            } else if (updatedJob.status === 'failed') {
              clearInterval(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: `Generation failed: ${updatedJob.error ?? 'Unknown error'}`, tone: 'danger' });
            }
          }
        }, 1000);
      } else {
        setIsGenerating(false);
        setStatusMsg({ text: !response.ok ? response.error.message : 'Failed to start generation job.', tone: 'danger' });
      }
    } catch (err) {
      setIsGenerating(false);
      setStatusMsg({ text: err instanceof Error ? err.message : 'Unexpected error during generation.', tone: 'danger' });
    }
  };

  const handleImportToProject = async (job: VideoGenerationJob): Promise<void> => {
    if (!job.outputFilePath) return;
    try {
      const status = await importTtsResult(job.id);
      setStatusMsg(status);
    } catch (err) {
      setStatusMsg({ text: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, tone: 'danger' });
    }
  };

  return (
    <div className="ai-workspace" role="region" aria-label="AI Video Studio">
      <div className="ai-workspace__header">
        <div>
          <p className="section-kicker">AI Studio</p>
          <h2>AI Video Generation</h2>
          <span className="ai-workspace__subtitle">Synthesize videos using Local AI Models or External Cloud APIs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <LlmModelSelectorBar />
          <div className="mode-toggle-group" role="radiogroup" aria-label="Execution mode selection">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'local'}
              className={`mode-toggle-btn ${mode === 'local' ? 'mode-toggle-btn--active' : ''}`}
              onClick={() => setMode('local')}
            >
              <span className="mode-badge mode-badge--local">Local</span>
              <span>Local Engine</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'api'}
              className={`mode-toggle-btn ${mode === 'api' ? 'mode-toggle-btn--active' : ''}`}
              onClick={() => setMode('api')}
            >
              <span className="mode-badge mode-badge--api">Cloud API</span>
              <span>External API</span>
            </button>
          </div>
        </div>
      </div>

      <div className="ai-workspace__grid">
        {/* Controls Column */}
        <div className="ai-workspace__form-panel">
          {mode === 'api' ? (
            <div className="ai-provider-select">
              <span className="field-label-text">Select Cloud AI Video Model</span>
              <div className="provider-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button
                  type="button"
                  className={`provider-chip ${apiProvider === 'gemini_veo' ? 'provider-chip--selected' : ''}`}
                  onClick={() => setApiProvider('gemini_veo')}
                >
                  Google Veo 3.1
                </button>
                <button
                  type="button"
                  className={`provider-chip ${apiProvider === 'openai_sora' ? 'provider-chip--selected' : ''}`}
                  onClick={() => setApiProvider('openai_sora')}
                >
                  OpenAI Sora
                </button>
                <button
                  type="button"
                  className={`provider-chip ${apiProvider === 'runway_gen4' ? 'provider-chip--selected' : ''}`}
                  onClick={() => setApiProvider('runway_gen4')}
                >
                  Runway Gen-4
                </button>
                <button
                  type="button"
                  className={`provider-chip ${apiProvider === 'kling_v3' ? 'provider-chip--selected' : ''}`}
                  onClick={() => setApiProvider('kling_v3')}
                >
                  Kling 3.0
                </button>
                <button
                  type="button"
                  className={`provider-chip ${apiProvider === 'luma_dream' ? 'provider-chip--selected' : ''}`}
                  onClick={() => setApiProvider('luma_dream')}
                >
                  Luma Dream
                </button>
              </div>

              <label className="field-label" style={{ marginTop: 'var(--space-3)' }}>
                API Key (
                {apiProvider === 'gemini_veo'
                  ? 'Google Gemini'
                  : apiProvider === 'openai_sora'
                    ? 'OpenAI'
                    : apiProvider === 'runway_gen4'
                      ? 'Runway ML'
                      : apiProvider === 'kling_v3'
                        ? 'Kling AI'
                        : 'Luma AI'}
                )
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter your API key...`}
                />
              </label>
            </div>
          ) : (
            <div className="local-status-banner">
              <span className="banner-title">💻 Local AI Video Diffusion Pipeline</span>
              <p className="banner-desc">Runs video synthesis model on your GPU/CPU. No cloud upload required.</p>
            </div>
          )}

          {/* Prompt Input */}
          <label className="field-label">
            Prompt Description
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the video scene (e.g. A serene cybernetic forest in neon rain, cinematic camera panning, 4k detail)..."
            />
          </label>

          {/* Preset Chips */}
          <div className="preset-group">
            <span className="field-label-text">Style Preset</span>
            <div className="chip-list">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`preset-chip ${selectedStyle === preset ? 'preset-chip--selected' : ''}`}
                  onClick={() => setSelectedStyle(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Configuration Options */}
          <div className="options-grid">
            <div>
              <span className="field-label-text">Aspect Ratio</span>
              <div className="chip-list">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`preset-chip ${aspectRatio === ratio ? 'preset-chip--selected' : ''}`}
                    onClick={() => setAspectRatio(ratio)}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="field-label-text">Duration</span>
              <div className="chip-list">
                {DURATIONS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={`preset-chip ${durationSeconds === sec ? 'preset-chip--selected' : ''}`}
                    onClick={() => setDurationSeconds(sec)}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={() => void handleGenerate()}
            disabled={isGenerating}
            style={{ width: '100%', marginTop: 'var(--space-4)', padding: 'var(--space-3)' }}
          >
            {isGenerating ? '✨ Generating Video...' : mode === 'local' ? '✨ Generate Local Video' : `⚡ Generate with ${apiProvider === 'gemini_veo' ? 'Gemini Veo' : 'OpenAI Sora'}`}
          </Button>

          <StatusCard tone={statusMsg.tone} style={{ marginTop: 'var(--space-3)' }}>
            {statusMsg.text}
          </StatusCard>
        </div>

        {/* Jobs / History Column */}
        <div className="ai-workspace__results-panel">
          <h3>Generated Video Assets</h3>
          {jobs.length === 0 ? (
            <div className="empty-slate">No video generation jobs yet. Write a prompt to begin.</div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <div key={job.id} className="job-card">
                  <div className="job-card__header">
                    <span className={`mode-badge mode-badge--${job.mode}`}>{job.mode === 'local' ? 'LOCAL' : 'CLOUD API'}</span>
                    <span className="job-card__provider">{job.provider}</span>
                    <span className={`job-status-pill job-status-pill--${job.status}`}>{job.status}</span>
                  </div>
                  <p className="job-card__prompt">&quot;{job.prompt}&quot;</p>

                  {job.status === 'completed' && job.outputFilePath && (
                    <div className="job-card__actions">
                      <Button variant="primary" onClick={() => void handleImportToProject(job)}>
                        📥 Import to Project Timeline
                      </Button>
                    </div>
                  )}

                  {job.status === 'running' && (
                    <div className="ai-progress-bar">
                      <div className="ai-progress-bar__fill" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
