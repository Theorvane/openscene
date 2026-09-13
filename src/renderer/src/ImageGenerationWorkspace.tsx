import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactElement } from 'react';

import {
  DEFAULT_GOOGLE_FLOW_PREFERENCES,
  GOOGLE_FLOW_PREFERENCES_STORAGE_KEY,
  parseGoogleFlowPreferences,
  type BrowserSessionStatus
} from '../../shared/browserSession';
import type { ImageAspectRatio, ImageGenerationJob, ImageGenerationRequest, ReferenceImageSelection } from '../../shared/providerSeams';
import type { ProductionImageHandoff, ProductionVisualStyle } from '../../shared/productionWorkflow';
import { useAiDomainModel } from './AiDomainModelContext';
import { DomainModelPicker } from './DomainModelPicker';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Photographic', 'Illustration', 'Anime', '3D Render', 'Cinematic', 'Flat Vector'] as const;
const ASPECT_RATIOS: readonly ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const IMAGE_JOB_UI_TIMEOUT_MS = 12 * 60_000;

type StatusMessage = { readonly text: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' };
type ImageGenerationMode = 'api' | 'browser_session';
type ImageStyleMode = 'preset' | 'writer' | 'custom';

export type ProductionImageBatchResult = {
  readonly requested: number;
  readonly completed: number;
  readonly failed: number;
  readonly notSubmitted: number;
  readonly message: string;
};

export type ImageGenerationWorkspaceHandle = {
  /** Runs production stills sequentially so browser automation remains single-flight. */
  generateProductionBriefs(handoffs: readonly ProductionImageHandoff[]): Promise<ProductionImageBatchResult>;
};

type ImageGenerationWorkspaceProps = {
  /** Hands a finished still to the video studio and switches to it. */
  readonly onUseForVideo: (reference: ReferenceImageSelection) => void;
  /** Local project folder/name mirrored to the signed-in Flow workspace. */
  readonly projectName?: string | undefined;
  /** Writer/Production Board target whose generated still is being reviewed. */
  readonly productionHandoff: ProductionImageHandoff | null;
  /** Approved Writer style made available even without a production handoff. */
  readonly synchronizedStyle: ProductionVisualStyle | null;
  /** Imports a reviewed job and persists its exact Character/Shot assignment. */
  readonly onAttachToProduction: (jobId: string, handoff: ProductionImageHandoff) => Promise<StatusMessage>;
};

function showGoogleFlowWindow(): boolean {
  try {
    return parseGoogleFlowPreferences(
      window.localStorage.getItem(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY)
    ).showWindowDuringGeneration;
  } catch {
    return DEFAULT_GOOGLE_FLOW_PREFERENCES.showWindowDuringGeneration;
  }
}

export const ImageGenerationWorkspace = forwardRef<ImageGenerationWorkspaceHandle, ImageGenerationWorkspaceProps>(function ImageGenerationWorkspace({
  onUseForVideo,
  projectName,
  productionHandoff,
  synchronizedStyle,
  onAttachToProduction
}, ref): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const imageModel = selectedModel('image-generation');
  const browserProvider = imageModel.providerId === 'google_gemini' || imageModel.providerId === 'xai';
  const browserLabel = imageModel.providerId === 'xai' ? 'Grok Imagine' : 'Google Flow';
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [selectedStyle, setSelectedStyle] = useState<string>('Photographic');
  const [styleMode, setStyleMode] = useState<ImageStyleMode>('preset');
  const [customStyle, setCustomStyle] = useState('');
  const [generationMode, setGenerationMode] = useState<ImageGenerationMode>(
    browserProvider ? 'browser_session' : 'api'
  );
  const [flowSession, setFlowSession] = useState<BrowserSessionStatus | null>(null);
  const [jobs, setJobs] = useState<readonly ImageGenerationJob[]>([]);
  const [productionTargetByJob, setProductionTargetByJob] = useState<Readonly<Record<string, ProductionImageHandoff>>>({});
  const [attachingJobId, setAttachingJobId] = useState<string | null>(null);
  const [attachedJobIds, setAttachedJobIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const queueActiveRef = useRef(false);
  const mountedRef = useRef(true);
  const previousProviderRef = useRef(imageModel.providerId);

  useEffect(() => {
    if (previousProviderRef.current === imageModel.providerId) return;
    previousProviderRef.current = imageModel.providerId;
    setGenerationMode(imageModel.providerId === 'google_gemini' || imageModel.providerId === 'xai' ? 'browser_session' : 'api');
  }, [imageModel.providerId]);

  useEffect(() => {
    void window.videoTool.getBrowserSessionStatuses().then((response) => {
      if (response.ok) setFlowSession(response.value.find((status) => status.providerId === (imageModel.providerId === 'xai' ? 'grok' : 'gemini')) ?? null);
    });
  }, [imageModel.providerId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (productionHandoff === null) return;
    setPrompt(productionHandoff.prompt);
    setNegativePrompt(productionHandoff.negativePrompt);
    setAspectRatio(productionHandoff.aspectRatio);
    setSelectedStyle(productionHandoff.stylePreset);
    setStyleMode(productionHandoff.styleSource === 'writer' ? 'writer' : 'preset');
    setStatusMsg({
      tone: 'neutral',
      text: `${productionHandoff.targetLabel} loaded from Writer. Review or edit the prompt, then generate; nothing is attached until you approve a completed image.`
    });
  }, [productionHandoff?.requestId]);

  const compileStyledPrompt = (basePrompt: string, styleDescription: string): string => {
    const trimmedStyle = styleDescription.trim();
    if (trimmedStyle.length === 0 || basePrompt.includes(trimmedStyle)) return basePrompt.trim();
    return `${basePrompt.trim()}\n\nVisual style: ${trimmedStyle}`;
  };

  const requestFor = async (input: {
    readonly prompt: string;
    readonly negativePrompt: string;
    readonly aspectRatio: ImageAspectRatio;
    readonly styleLabel: string;
    readonly styleDescription: string;
  }, handoff: ProductionImageHandoff | null): Promise<ImageGenerationRequest> => {
    const flowWindowVisible = generationMode === 'browser_session' && showGoogleFlowWindow();
    const referenceImages = handoff === null || handoff.referenceAssetIds.length === 0
      ? []
      : await Promise.all(handoff.referenceAssetIds.map(async (referenceId) => {
        const reference = await window.videoTool.aiGetProjectImageReference({ projectId: handoff.projectId, assetId: referenceId });
        if (!reference.ok) throw new Error(`Reference image ${referenceId} could not be loaded for this production frame.`);
        return reference.value;
      }));
    return {
      prompt: compileStyledPrompt(input.prompt, input.styleDescription),
      aspectRatio: input.aspectRatio,
      stylePreset: input.styleLabel,
      modelId: imageModel.id,
      mode: generationMode,
      ...(referenceImages.length === 0 ? {} : { referenceImage: referenceImages[0], referenceImages }),
      ...(generationMode === 'browser_session'
        ? { showBrowserWindow: flowWindowVisible, ...(projectName === undefined ? {} : { flowProjectName: projectName }) }
        : {}),
      ...(input.negativePrompt.trim().length === 0 ? {} : { negativePrompt: input.negativePrompt.trim() })
    };
  };

  const submitAndWait = async (
    request: ImageGenerationRequest,
    handoff: ProductionImageHandoff | null
  ): Promise<{ readonly ok: true; readonly job: ImageGenerationJob } | { readonly ok: false; readonly error: string; readonly haltQueue: boolean }> => {
    try {
      const response = await window.videoTool.aiGenerateImage(request);
      if (!response.ok) return { ok: false, error: response.error.message, haltQueue: false };
      const started = response.value;
      setJobs((prev) => [started, ...prev]);
      if (handoff !== null) {
        setProductionTargetByJob((current) => ({ ...current, [started.id]: handoff }));
      }
      const deadline = Date.now() + IMAGE_JOB_UI_TIMEOUT_MS;
      let updated = started;
      while (mountedRef.current && Date.now() < deadline) {
        if (updated.status === 'completed') return { ok: true, job: updated };
        if (updated.status === 'needs_user_action') {
          return { ok: false, error: updated.error ?? 'The signed-in browser session needs attention before generation can continue.', haltQueue: true };
        }
        if (updated.status === 'failed') {
          return { ok: false, error: updated.error ?? 'Image generation failed.', haltQueue: false };
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
        const poll = await window.videoTool.aiGetImageJob(started.id);
        if (!poll.ok) return { ok: false, error: poll.error.message, haltQueue: true };
        updated = poll.value;
        setJobs((prev) => prev.map((existing) => existing.id === updated.id ? updated : existing));
      }
      return { ok: false, error: 'Stopped waiting after 12 minutes. Check the terminal log before retrying.', haltQueue: true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unexpected error during generation.', haltQueue: true };
    }
  };

  const runProductionBriefs = async (handoffs: readonly ProductionImageHandoff[]): Promise<ProductionImageBatchResult> => {
    if (queueActiveRef.current) {
      return { requested: handoffs.length, completed: 0, failed: 0, notSubmitted: handoffs.length, message: 'Another image queue is already running.' };
    }
    if (handoffs.length === 0) return { requested: 0, completed: 0, failed: 0, notSubmitted: 0, message: 'No eligible production images need generation.' };
    queueActiveRef.current = true;
    setIsGenerating(true);
    let completed = 0;
    let failed = 0;
    let attempted = 0;
    try {
      for (const [index, handoff] of handoffs.entries()) {
        if (!mountedRef.current) break;
        setStatusMsg({ tone: 'neutral', text: `Production image ${index + 1}/${handoffs.length}: ${handoff.targetLabel}. Browser jobs run one at a time.` });
        const request = await requestFor({
          prompt: handoff.prompt,
          negativePrompt: handoff.negativePrompt,
          aspectRatio: handoff.aspectRatio,
          styleLabel: handoff.stylePreset,
          styleDescription: handoff.styleDescription
        }, handoff);
        const result = await submitAndWait(request, handoff);
        attempted += 1;
        if (result.ok) completed += 1;
        else {
          failed += 1;
          if (result.haltQueue) break;
        }
      }
    } finally {
      queueActiveRef.current = false;
      if (mountedRef.current) setIsGenerating(false);
    }
    const notSubmitted = handoffs.length - attempted;
    const message = `${completed}/${attempted} submitted production image job(s) completed${failed > 0 ? `; ${failed} failed or need attention` : ''}${notSubmitted > 0 ? `; ${notSubmitted} not submitted after the queue stopped` : ''}. Review and attach each result explicitly.`;
    if (mountedRef.current) setStatusMsg({ tone: failed === 0 ? 'success' : completed > 0 ? 'warning' : 'danger', text: message });
    return { requested: handoffs.length, completed, failed, notSubmitted, message };
  };

  useImperativeHandle(ref, () => ({ generateProductionBriefs: runProductionBriefs }));

  const handleGenerate = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setStatusMsg({ text: 'Please enter an image generation prompt.', tone: 'warning' });
      return;
    }
    if (queueActiveRef.current) {
      setStatusMsg({ text: 'Wait for the current image queue to finish.', tone: 'warning' });
      return;
    }
    const styleLabel = styleMode === 'writer'
      ? synchronizedStyle?.label ?? 'Writer Style Bible'
      : styleMode === 'custom' ? 'Custom image style' : selectedStyle;
    const styleDescription = styleMode === 'writer'
      ? synchronizedStyle?.description ?? productionHandoff?.styleDescription ?? ''
      : styleMode === 'custom' ? customStyle.trim() : `${selectedStyle} visual style`;
    if (styleMode === 'custom' && customStyle.trim().length === 0) {
      setStatusMsg({ text: 'Describe the custom visual style before generating.', tone: 'warning' });
      return;
    }
    queueActiveRef.current = true;
    setIsGenerating(true);
    const flowWindowVisible = generationMode === 'browser_session' && showGoogleFlowWindow();
    setStatusMsg({ tone: 'neutral', text: generationMode === 'browser_session'
      ? flowWindowVisible
        ? `Opening the signed-in ${browserLabel} window…`
        : `Starting the hidden signed-in ${browserLabel} image worker…`
      : `Submitting ${imageModel.providerLabel} image job…` });
    try {
      const request = await requestFor({ prompt, negativePrompt, aspectRatio, styleLabel, styleDescription }, productionHandoff);
      const result = await submitAndWait(request, productionHandoff);
      setStatusMsg(result.ok ? { text: 'Image ready.', tone: 'success' } : { text: result.error, tone: 'danger' });
    } finally {
      queueActiveRef.current = false;
      if (mountedRef.current) setIsGenerating(false);
    }
  };

  const handleSave = async (job: ImageGenerationJob): Promise<void> => {
    const response = await window.videoTool.aiSaveImageResult(job.id);
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    // A cancelled save dialog is a decision, not a failure.
    if (response.value.saved) setStatusMsg({ text: 'Image saved.', tone: 'success' });
  };

  const handleUseForVideo = async (job: ImageGenerationJob): Promise<void> => {
    const response = await window.videoTool.aiUseImageAsVideoReference(job.id);
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    // Puts the still into the video form and moves the user there, rather than
    // telling them to save it and pick it again.
    onUseForVideo(response.value);
  };

  const handleAttachToProduction = async (job: ImageGenerationJob): Promise<void> => {
    const handoff = productionTargetByJob[job.id];
    if (handoff === undefined) {
      setStatusMsg({ text: 'This image job has no Writer Character/Shot target.', tone: 'warning' });
      return;
    }
    setAttachingJobId(job.id);
    try {
      const result = await onAttachToProduction(job.id, handoff);
      setStatusMsg(result);
      if (result.tone === 'success') {
        setAttachedJobIds((current) => new Set([...current, job.id]));
      }
    } catch (error: unknown) {
      setStatusMsg({
        text: error instanceof Error ? error.message : 'The generated image could not be attached to production.',
        tone: 'danger'
      });
    } finally {
      setAttachingJobId(null);
    }
  };

  return (
    <section className="studio-surface" aria-labelledby="image-generation-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="image-generation-title">
            Image Generation
          </h2>
          <span className="studio-surface__title-meta">
            {generationMode === 'browser_session' ? `Signed-in ${browserLabel} worker` : 'Cloud image generation'}
          </span>
        </div>
        <DomainModelPicker
          domain="image-generation"
          ariaLabel="Image model"
          linkedProviderIds={flowSession?.kind === 'stored' ? [imageModel.providerId] : []}
        />
      </header>

      <div className="studio-surface__body">
        {productionHandoff !== null && (
          <StatusCard tone="neutral">
            <strong>{productionHandoff.targetLabel}</strong><br />
            This is a reviewed production handoff. {productionHandoff.referenceAssetIds.length > 0
              ? `${productionHandoff.referenceAssetIds.length} approved production reference image(s) will be uploaded in the saved order (world/style first when assigned, then character identity).`
              : 'No approved image reference is attached to this target.'} Generate an image, inspect it, then explicitly attach it to return to the production board.
          </StatusCard>
        )}
        {browserProvider && (
          <div className="studio-field">
            <span className="studio-field__label">Connection</span>
            <div className="studio-chips" role="group" aria-label={`${browserLabel} connection mode`}>
              <button
                type="button"
                aria-pressed={generationMode === 'browser_session'}
                className={`studio-chip${generationMode === 'browser_session' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('browser_session')}
              >
                {browserLabel} session
              </button>
              <button
                type="button"
                aria-pressed={generationMode === 'api'}
                disabled={imageModel.providerId === 'xai'}
                className={`studio-chip${generationMode === 'api' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('api')}
              >
                API key
              </button>
            </div>
            {generationMode === 'browser_session' && (
              <StatusCard tone={flowSession?.kind === 'stored' ? 'success' : 'warning'}>
                {flowSession?.kind === 'stored'
                  ? `${browserLabel} session ready. Generate runs in the signed-in browser and imports the result automatically.`
                  : `No ready ${browserLabel} session detected. Sign in under Settings → Providers before generating.`}
              </StatusCard>
            )}
          </div>
        )}

        <div className="studio-field">
          <span className="studio-field__label">Style</span>
          <div className="studio-chips" role="group" aria-label="Style preset">
            {synchronizedStyle !== null && (
              <button
                type="button"
                aria-pressed={styleMode === 'writer'}
                className={`studio-chip${styleMode === 'writer' ? ' studio-chip--selected' : ''}`}
                onClick={() => setStyleMode('writer')}
              >
                Sync Writer · {synchronizedStyle.label}
              </button>
            )}
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={styleMode === 'preset' && selectedStyle === preset}
                className={`studio-chip${styleMode === 'preset' && selectedStyle === preset ? ' studio-chip--selected' : ''}`}
                onClick={() => { setStyleMode('preset'); setSelectedStyle(preset); }}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={styleMode === 'custom'}
              className={`studio-chip${styleMode === 'custom' ? ' studio-chip--selected' : ''}`}
              onClick={() => setStyleMode('custom')}
            >Custom</button>
          </div>
          {styleMode === 'custom' && (
            <textarea
              aria-label="Custom image style"
              className="studio-input"
              maxLength={400}
              rows={2}
              value={customStyle}
              placeholder="Example: Traditional inked 2D cel animation, flat painted fills, restrained multiplane depth…"
              onChange={(event) => setCustomStyle(event.target.value)}
            />
          )}
          {styleMode === 'writer' && synchronizedStyle !== null && (
            <small>Locked to the approved Writer direction and Style Bible for consistent production images.</small>
          )}
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
          <label className="studio-field__label" htmlFor="image-negative-prompt">
            Avoid
          </label>
          <input
            id="image-negative-prompt"
            className="studio-input"
            type="text"
            value={negativePrompt}
            placeholder="Optional — what to keep out of the frame"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </div>

        {statusMsg !== null && <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>}

        <div className="studio-field">
          <span className="studio-field__label">Results</span>
          {jobs.length === 0 ? (
            <p className="studio-empty">No image jobs yet.</p>
          ) : (
            <ul className="studio-job-list">
              {jobs.map((job) => (
                <li key={job.id} className="studio-job">
                  <div className="studio-job__row">
                    <span className={`studio-job__status studio-job__status--${job.status}`}>{job.status}</span>
                    <span className="studio-job__provider">
                      {job.provider}{job.mode === 'browser_session' ? ' · signed-in session' : ''}
                    </span>
                  </div>
                  {job.previewBase64 !== undefined && (
                    <img
                      className="studio-image-result"
                      src={`data:${job.previewMimeType ?? 'image/png'};base64,${job.previewBase64}`}
                      alt={`Generated image for prompt: ${job.prompt}`}
                    />
                  )}
                  <p className="studio-job__prompt">{job.prompt}</p>
                  {(job.status === 'failed' || job.status === 'needs_user_action') && job.error !== undefined && (
                    <p className="studio-job__error">{job.error}</p>
                  )}
                  {job.status === 'completed' && (
                    <div className="studio-job__actions">
                      {productionTargetByJob[job.id] !== undefined && (
                        <Button
                          variant="primary"
                          disabled={attachingJobId !== null || attachedJobIds.has(job.id)}
                          onClick={() => void handleAttachToProduction(job)}
                        >
                          {attachedJobIds.has(job.id)
                            ? 'Attached to production'
                            : attachingJobId === job.id
                              ? 'Importing and attachingâ€¦'
                              : `Attach to ${productionTargetByJob[job.id]!.targetLabel}`}
                        </Button>
                      )}
                      <Button variant="primary" onClick={() => void handleUseForVideo(job)}>
                        Use for video
                      </Button>
                      <Button variant="default" onClick={() => void handleSave(job)}>
                        Save image
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="studio-composer">
        <textarea
          className="studio-composer__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the image…"
          aria-label="Image prompt"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">
            {aspectRatio} · {styleMode === 'writer'
              ? synchronizedStyle?.label ?? 'Writer Style Bible'
              : styleMode === 'custom' ? customStyle.trim() || 'Custom style required' : selectedStyle}
            {negativePrompt.trim().length === 0 ? '' : ' · avoid set'}
            {generationMode === 'browser_session' ? ` · ${browserLabel} session` : ''}
          </span>
          <Button
            variant="primary"
            onClick={() => void handleGenerate()}
            disabled={isGenerating || prompt.trim().length === 0}
          >
            {isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
});
