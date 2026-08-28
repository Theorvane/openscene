import { useState, type ReactElement } from 'react';

import { originalOf, refineShotPrompt, revisionsOf } from '../../shared/shotPrompt';
import type { ReferenceImageSelection, VideoGenerationJob } from '../../shared/providerSeams';
import { DomainModelPicker } from './DomainModelPicker';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { supportedShotSeconds } from '../../shared/videoStoryboardPlan';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;

/**
 * Read from the same table the agent's planner and the createVideoJob schema
 * use. Three copies of these numbers is how a 12s Sora shot became something
 * the UI offered and the tool rejected.
 */
const durationOptionsFor = supportedShotSeconds;

type VideoGenerationWorkspaceProps = {
  /**
   * Controlled from App so the image studio's "Use for video" can hand a
   * generated still straight into this form. Keeping it local meant the handoff
   * could only ever be a suggestion to go and re-pick the file.
   */
  readonly referenceImage: ReferenceImageSelection | null;
  readonly onReferenceImageChange: (reference: ReferenceImageSelection | null) => void;
};

export function VideoGenerationWorkspace({
  referenceImage,
  onReferenceImageChange
}: VideoGenerationWorkspaceProps): ReactElement {
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
  // Image-to-video seed: the bytes travel inline, so no path reaches here.
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  // Which take is being refined, and what to change about it. A note belongs to
  // one job: applying the last one to a different take would be a change nobody
  // asked for on a shot they were happy with.
  const [refiningJobId, setRefiningJobId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Nothing to report until something happens; an idle card is just noise.
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } | null>(null);

  /**
   * `overrides` is how a refined take is run: it carries the previous take's
   * own prompt, length, shape and style, so asking for one change does not
   * silently apply whatever the composer happens to be set to now.
   */
  const handleGenerate = async (overrides?: {
    readonly prompt: string;
    readonly aspectRatio: '16:9' | '9:16' | '1:1';
    readonly durationSeconds: number;
    readonly stylePreset?: string;
  }): Promise<void> => {
    const promptText = overrides?.prompt ?? prompt;
    if (promptText.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatusMsg({ text: `Submitting ${videoModel.providerLabel} cloud job...`, tone: 'neutral' });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt: promptText,
        aspectRatio: overrides?.aspectRatio ?? aspectRatio,
        durationSeconds: overrides?.durationSeconds ?? effectiveDuration,
        stylePreset: overrides?.stylePreset ?? selectedStyle,
        modelId: videoModel.id,
        ...(referenceImage === null ? {} : { referenceImage })
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

  /**
   * The next take of a job, with a note about what to change.
   *
   * The previous prompt is kept whole and the change added to it by the shared
   * rule — the same one the phone uses — because a rewrite loses the parts
   * nobody mentioned, which are the parts a shot is made of.
   */
  const refineJob = (job: VideoGenerationJob): void => {
    const refined = refineShotPrompt(job.prompt, note);
    if (!refined.ok) {
      setStatusMsg({ text: refined.reason, tone: 'warning' });
      return;
    }
    setRefiningJobId(null);
    setNote('');
    // Shown in the composer as well, so what was asked for is visible rather
    // than only implied by a new job appearing.
    setPrompt(refined.prompt);
    void handleGenerate({
      prompt: refined.prompt,
      aspectRatio: job.aspectRatio,
      durationSeconds: job.durationSeconds,
      ...(job.stylePreset === undefined ? {} : { stylePreset: job.stylePreset })
    });
  };

  const pickReferenceImage = async (): Promise<void> => {
    const response = await window.videoTool.aiSelectReferenceImage();
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    if (response.value !== null) onReferenceImageChange(response.value);
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

        {statusMsg !== null && <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>}

        <div className="studio-field">
          <span className="studio-field__label">Reference image</span>
          {referenceImage === null ? (
            <div className="studio-reference">
              <span className="studio-reference__empty">Optional — seeds image-to-video generation.</span>
              <Button variant="ghost" onClick={() => void pickReferenceImage()}>Add image</Button>
            </div>
          ) : (
            <div className="studio-reference">
              <img
                className="studio-reference__thumb"
                src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`}
                alt={`Reference image ${referenceImage.displayName}`}
              />
              <span className="studio-reference__name">{referenceImage.displayName}</span>
              <Button variant="ghost" onClick={() => onReferenceImageChange(null)} aria-label="Remove reference image">
                Remove
              </Button>
            </div>
          )}
        </div>

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
                  <p className="studio-job__prompt">{originalOf(job.prompt)}</p>
                  {revisionsOf(job.prompt).length > 0 && (
                    <ol className="studio-job__revisions">
                      {revisionsOf(job.prompt).map((revision) => (
                        <li key={revision}>{revision}</li>
                      ))}
                    </ol>
                  )}
                  {job.status === 'completed' && job.outputFilePath !== undefined && (
                    <Button variant="primary" onClick={() => void handleImportToProject(job)}>
                      Import to project
                    </Button>
                  )}
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <Button
                      variant="ghost"
                      disabled={isGenerating}
                      onClick={() => {
                        setNote('');
                        setRefiningJobId(refiningJobId === job.id ? null : job.id);
                      }}
                    >
                      {refiningJobId === job.id ? 'Cancel' : 'Refine'}
                    </Button>
                  )}
                  {refiningJobId === job.id && (
                    <div className="studio-refine">
                      <textarea
                        className="studio-refine__input"
                        rows={2}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="What to change — slower, no text on screen…"
                        aria-label={`What to change about this take`}
                      />
                      <Button variant="primary" disabled={note.trim().length === 0} onClick={() => refineJob(job)}>
                        Generate next take
                      </Button>
                    </div>
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
          <span className="studio-composer__hint">
            {effectiveDuration}s · {aspectRatio} · {selectedStyle}{referenceImage === null ? '' : ' · image'}
          </span>
          <Button variant="primary" onClick={() => void handleGenerate()} disabled={isGenerating || prompt.trim().length === 0}>
            {isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
