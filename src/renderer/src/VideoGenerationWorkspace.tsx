import { useState, type ReactElement } from 'react';
import type { VideoGenerationJob } from '../../shared/providerSeams';
import { DomainModelPicker } from './DomainModelPicker';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;

/** Duration choices per engine: Sora accepts 4/8/12s, Veo 4–8s. */
function durationOptionsFor(providerId: string): readonly number[] {
  if (providerId === 'openai') return [4, 8, 12];
  if (providerId === 'google_gemini') return [4, 6, 8];
  return [4, 8];
}

export function VideoGenerationWorkspace(): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const videoModel = selectedModel('video-generation');
  const { importAiResult } = useProjectResultImport();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const durationOptions = durationOptionsFor(videoModel.providerId);
  // Switching engines keeps the chosen length when valid, else the closest option.
  const effectiveDuration = durationOptions.includes(durationSeconds)
    ? durationSeconds
    : durationOptions.reduce((best, candidate) =>
        Math.abs(candidate - durationSeconds) < Math.abs(best - durationSeconds) ? candidate : best
      );
  const [selectedStyle, setSelectedStyle] = useState<string>('Cinematic');
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }>({
    text: 'Ready to generate AI video. Connect a video provider in Settings → Providers to begin.',
    tone: 'neutral'
  });

  const handleGenerate = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatusMsg({ text: `Submitting ${videoModel.providerLabel} cloud job...`, tone: 'neutral' });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt,
        aspectRatio,
        durationSeconds: effectiveDuration,
        stylePreset: selectedStyle,
        modelId: videoModel.id
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
    <section className="studio-surface" aria-labelledby="video-generation-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="video-generation-title">Video Generation</h2>
          {/* The picker beside it already names the model and provider. */}
          <span className="studio-surface__title-meta">Cloud video generation</span>
        </div>
        <DomainModelPicker domain="video-generation" ariaLabel="Video model" />
      </header>

      <div className="studio-surface__body">
        <div className="studio-field">
          <span className="studio-field__label">Style</span>
          <div className="studio-chips" role="group" aria-label="Style preset">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={selectedStyle === preset}
                className={`studio-chip${selectedStyle === preset ? ' studio-chip--selected' : ''}`}
                onClick={() => setSelectedStyle(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field">
          <span className="studio-field__label">Aspect ratio</span>
          <div className="studio-chips" role="group" aria-label="Aspect ratio">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={aspectRatio === ratio}
                className={`studio-chip${aspectRatio === ratio ? ' studio-chip--selected' : ''}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field">
          <span className="studio-field__label">Duration</span>
          <div className="studio-chips" role="group" aria-label="Duration">
            {durationOptions.map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={effectiveDuration === sec}
                className={`studio-chip${effectiveDuration === sec ? ' studio-chip--selected' : ''}`}
                onClick={() => setDurationSeconds(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>

        <div className="studio-field">
          <span className="studio-field__label">Jobs</span>
          {jobs.length === 0 ? (
            <p className="studio-empty">No generation jobs yet.</p>
          ) : (
            <ul className="studio-job-list">
              {jobs.map((job) => (
                <li key={job.id} className="studio-job">
                  <div className="studio-job__row">
                    <span className={`studio-job__status studio-job__status--${job.status}`}>{job.status}</span>
                    <span className="studio-job__provider">{job.provider}</span>
                  </div>
                  <p className="studio-job__prompt">{job.prompt}</p>
                  {job.status === 'completed' && job.outputFilePath !== undefined && (
                    <Button variant="primary" onClick={() => void handleImportToProject(job)}>
                      Import to project
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Composer mirrors the chat prompt card: write, then act. */}
      <div className="studio-composer">
        <textarea
          className="studio-composer__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the shot…"
          aria-label="Video prompt"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">{effectiveDuration}s · {aspectRatio} · {selectedStyle}</span>
          <Button variant="primary" onClick={() => void handleGenerate()} disabled={isGenerating || prompt.trim().length === 0}>
            {isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
