import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { VideoGenerationJob } from '../../shared/providerSeams';
import { AiDomainModelSelector } from './AiDomainModelSelector';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Product film', 'Anime', 'Documentary', 'Editorial', 'Film noir'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
const DURATIONS = [3, 5, 10] as const;

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

type StudioStatus = {
  readonly text: string;
  readonly tone: StatusTone;
};

function isTerminalJobStatus(status: VideoGenerationJob['status']): boolean {
  return status === 'completed' || status === 'failed';
}

export function PromptStudioWorkspace(): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const videoModel = selectedModel('video-generation');
  const { importAiResult } = useProjectResultImport();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [selectedStyle, setSelectedStyle] = useState<(typeof STYLE_PRESETS)[number]>('Cinematic');
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<StudioStatus>({
    text: 'Describe the shot you want to make. Your current local video runner handles the render.',
    tone: 'neutral'
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = (): void => {
    if (pollTimerRef.current === null) return;
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const pollJob = (jobId: string): void => {
    stopPolling();
    pollTimerRef.current = setInterval(() => {
      void window.videoTool.aiGetVideoJob(jobId).then((response) => {
        if (!response.ok || !response.value) {
          stopPolling();
          setIsGenerating(false);
          setStatus({ text: !response.ok ? response.error.message : 'Could not refresh the video job.', tone: 'danger' });
          return;
        }

        const job = response.value as VideoGenerationJob;
        setJobs((currentJobs) => currentJobs.map((currentJob) => currentJob.id === job.id ? job : currentJob));
        if (!isTerminalJobStatus(job.status)) return;

        stopPolling();
        setIsGenerating(false);
        setStatus(job.status === 'completed'
          ? { text: 'Your video is ready. Review it here or send it to the timeline when you are ready to edit.', tone: 'success' }
          : { text: job.error ?? 'The video job did not complete.', tone: 'danger' });
      }).catch((error: unknown) => {
        stopPolling();
        setIsGenerating(false);
        setStatus({ text: error instanceof Error ? error.message : 'Could not refresh the video job.', tone: 'danger' });
      });
    }, 1000);
  };

  const handleGenerate = async (): Promise<void> => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setStatus({ text: 'Add a prompt before starting a video job.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatus({ text: 'Starting your local video job…', tone: 'neutral' });
    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt: normalizedPrompt,
        aspectRatio,
        durationSeconds,
        stylePreset: selectedStyle,
        mode: 'local',
        provider: 'local_video',
        modelId: videoModel.id
      });
      if (!response.ok || !response.value) {
        setIsGenerating(false);
        setStatus({ text: !response.ok ? response.error.message : 'Could not start the video job.', tone: 'danger' });
        return;
      }

      const job = response.value as VideoGenerationJob;
      setJobs((currentJobs) => [job, ...currentJobs]);
      setStatus({ text: 'Rendering locally. This screen will update when the asset is ready.', tone: 'neutral' });
      pollJob(job.id);
    } catch (error) {
      setIsGenerating(false);
      setStatus({ text: error instanceof Error ? error.message : 'Could not start the video job.', tone: 'danger' });
    }
  };

  const handleImport = async (job: VideoGenerationJob): Promise<void> => {
    try {
      setStatus(await importAiResult(job.id));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : 'Could not import the video into your project.', tone: 'danger' });
    }
  };

  return (
    <div className="ai-workspace" role="region" aria-label="Prompt Studio">
      <div className="ai-workspace__header">
        <div>
          <p className="section-kicker">Create</p>
          <h2>Prompt Studio</h2>
          <span className="ai-workspace__subtitle">Turn a clear idea into a local video asset, then refine it in the timeline.</span>
        </div>
        <AiDomainModelSelector domain="video-generation" label="Video model" />
        <span className="local-pill">Local render</span>
      </div>

      <div className="ai-workspace__grid">
        <section className="ai-workspace__form-panel" aria-label="Video prompt controls">
          <div className="local-status-banner">
            <span className="banner-title">Start with the shot</span>
            <p className="banner-desc">OpenVideo uses your configured local runner. Your prompt and generated assets stay on this machine.</p>
          </div>

          <label className="field-label">
            What should happen in this video?
            <textarea
              rows={6}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A tracking shot through a rain-soaked Seoul alley at blue hour, reflected neon, shallow depth of field, cinematic motion…"
            />
          </label>

          <div className="preset-group">
            <span className="field-label-text">Visual direction</span>
            <div className="chip-list">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`preset-chip ${selectedStyle === preset ? 'preset-chip--selected' : ''}`}
                  aria-pressed={selectedStyle === preset}
                  onClick={() => setSelectedStyle(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="options-grid">
            <div>
              <span className="field-label-text">Frame</span>
              <div className="chip-list">
                {ASPECT_RATIOS.map((ratio) => (
                  <button key={ratio} type="button" className={`preset-chip ${aspectRatio === ratio ? 'preset-chip--selected' : ''}`} aria-pressed={aspectRatio === ratio} onClick={() => setAspectRatio(ratio)}>{ratio}</button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label-text">Duration</span>
              <div className="chip-list">
                {DURATIONS.map((seconds) => (
                  <button key={seconds} type="button" className={`preset-chip ${durationSeconds === seconds ? 'preset-chip--selected' : ''}`} aria-pressed={durationSeconds === seconds} onClick={() => setDurationSeconds(seconds)}>{seconds}s</button>
                ))}
              </div>
            </div>
          </div>

          <Button variant="primary" onClick={() => void handleGenerate()} disabled={isGenerating} style={{ width: '100%', marginTop: 'var(--space-4)', padding: 'var(--space-3)' }}>
            {isGenerating ? 'Generating video…' : 'Generate video'}
          </Button>
          <StatusCard tone={status.tone} style={{ marginTop: 'var(--space-3)' }}>{status.text}</StatusCard>
        </section>

        <section className="ai-workspace__results-panel" aria-label="Prompt Studio results">
          <h3>Recent generations</h3>
          {jobs.length === 0 ? (
            <div className="empty-slate">Your video concepts will appear here. Start with one focused shot.</div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <article key={job.id} className="job-card">
                  <div className="job-card__header">
                    <span className="mode-badge mode-badge--local">LOCAL</span>
                    <span className="job-card__provider">{job.provider}</span>
                    <span className={`job-status-pill job-status-pill--${job.status}`}>{job.status}</span>
                  </div>
                  <p className="job-card__prompt">“{job.prompt}”</p>
                  {job.status === 'running' && <div className="ai-progress-bar"><div className="ai-progress-bar__fill" /></div>}
                  {job.status === 'completed' && job.outputFilePath && (
                    <div className="job-card__actions">
                      <Button variant="primary" onClick={() => void handleImport(job)}>Add to timeline</Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
