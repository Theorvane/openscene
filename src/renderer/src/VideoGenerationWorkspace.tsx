import { useState, type ReactElement } from 'react';
import type { VideoGenerationJob } from '../../shared/providerSeams';
import { LlmModelSelectorBar } from './LlmModelSelectorBar';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
const DURATIONS = [3, 5, 10] as const;

export function VideoGenerationWorkspace(): ReactElement {
  const { importAiResult } = useProjectResultImport();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [selectedStyle, setSelectedStyle] = useState<string>('Cinematic');
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }>({
    text: 'Ready to generate AI video. Configure your local runner to begin.',
    tone: 'neutral'
  });

  const handleGenerate = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatusMsg({ text: 'Submitting Local AI Engine job...', tone: 'neutral' });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt,
        aspectRatio,
        durationSeconds,
        stylePreset: selectedStyle,
        mode: 'local'
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
      const status = await importAiResult(job.id);
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
          <span className="ai-workspace__subtitle">Synthesize videos using a locally configured AI runner</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <LlmModelSelectorBar />
        </div>
      </div>

      <div className="ai-workspace__grid">
        {/* Controls Column */}
        <div className="ai-workspace__form-panel">
          <div className="local-status-banner">
            <span className="banner-title">💻 Local AI Video Diffusion Pipeline</span>
            <p className="banner-desc">Runs video synthesis model on your GPU/CPU. No cloud upload required.</p>
          </div>

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
            {isGenerating ? '✨ Generating Video...' : '✨ Generate Local Video'}
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
