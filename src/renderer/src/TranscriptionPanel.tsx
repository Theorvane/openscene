import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import type { SubtitleCue } from '../../shared/narrationPlan';
import { updateTranscriptionDraft, type TranscriptionDraft, type TranscriptionJob, type WhisperCppRuntimeStatus } from '../../shared/transcription';
import type { MediaAsset, TimelineDocument } from '../../shared/timelineTypes';
import type { StatusMessage } from './appTypes';
import { Button, StatusCard } from './ui';

const LANGUAGES = [
  { id: 'auto', label: 'Auto detect' },
  { id: 'vi', label: 'Vietnamese' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'es', label: 'Spanish' }
] as const;

export function TranscriptionPanel({ projectId, assets, timeline, document, onSaveAi, onApplyCaptions }: {
  readonly projectId: string;
  readonly assets: readonly MediaAsset[];
  readonly timeline: TimelineDocument;
  readonly document: AiProjectDocument;
  readonly onSaveAi: (document: AiProjectDocument) => Promise<boolean>;
  readonly onApplyCaptions: (draft: TranscriptionDraft) => boolean;
}): ReactElement {
  const sources = useMemo(() => assets.filter((asset) => asset.kind === 'audio' || asset.kind === 'video'), [assets]);
  const persistedDraft = document.transcriptionDraft ?? null;
  const [sourceAssetId, setSourceAssetId] = useState(persistedDraft?.sourceAssetId ?? sources[0]?.id ?? '');
  const [language, setLanguage] = useState(persistedDraft?.language ?? 'auto');
  const [draft, setDraft] = useState<TranscriptionDraft | null>(persistedDraft);
  const [savedDraft, setSavedDraft] = useState<TranscriptionDraft | null>(persistedDraft);
  const [runtime, setRuntime] = useState<WhisperCppRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const pollingGeneration = useRef(0);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const sourceMissing = draft !== null && !sources.some((asset) => asset.id === draft.sourceAssetId);
  const sourceNotPlaced = draft !== null && !timeline.tracks.some((track) => track.clips.some((clip) => clip.assetId === draft.sourceAssetId));

  useEffect(() => {
    let active = true;
    setRuntimeLoading(true);
    void window.videoTool.getTranscriptionRuntimeStatus().then((response) => {
      if (!active) return;
      setRuntimeLoading(false);
      if (response.ok) setRuntime(response.value);
      else setRuntime({ ready: false, checksumVerified: false, reason: response.error.message });
    }).catch((error: unknown) => {
      if (!active) return;
      setRuntimeLoading(false);
      setRuntime({ ready: false, checksumVerified: false, reason: error instanceof Error ? error.message : 'Could not inspect whisper.cpp.' });
    });
    return () => { active = false; };
  }, [runtimeRevision]);

  useEffect(() => () => { pollingGeneration.current += 1; }, []);

  const poll = (jobId: string, generation: number, deadline: number): void => {
    window.setTimeout(() => {
      if (pollingGeneration.current !== generation) return;
      if (Date.now() >= deadline) {
        pollingGeneration.current += 1;
        setStatus({ tone: 'danger', text: 'Transcription polling exceeded 65 minutes. The local job was cancelled; check the terminal log.' });
        void window.videoTool.cancelTranscriptionJob(jobId);
        return;
      }
      void window.videoTool.getTranscriptionJob(jobId).then((response) => {
        if (pollingGeneration.current !== generation) return;
        if (!response.ok) {
          pollingGeneration.current += 1;
          setStatus({ tone: 'danger', text: response.error.message });
          return;
        }
        setJob(response.value);
        if (response.value.status === 'completed' && response.value.draft !== undefined) {
          pollingGeneration.current += 1;
          setDraft(response.value.draft);
          setSavedDraft(null);
          setLanguage(response.value.draft.language);
          setStatus({ tone: 'success', text: `${response.value.draft.cues.length} timed cue(s) detected. Review the words and timing before approval.` });
          return;
        }
        if (response.value.status === 'failed' || response.value.status === 'cancelled') {
          pollingGeneration.current += 1;
          setStatus({ tone: response.value.status === 'failed' ? 'danger' : 'neutral', text: response.value.error ?? (response.value.status === 'cancelled' ? 'Transcription cancelled.' : 'Transcription failed.') });
          return;
        }
        poll(jobId, generation, deadline);
      }).catch((error: unknown) => {
        if (pollingGeneration.current !== generation) return;
        pollingGeneration.current += 1;
        setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Transcription status could not be read.' });
      });
    }, 1_000);
  };

  const start = async (): Promise<void> => {
    if (!runtime?.ready || !sourceAssetId) return;
    pollingGeneration.current += 1;
    setJob(null);
    setStatus({ tone: 'neutral', text: 'Starting local audio normalization and speech recognition…' });
    try {
      const response = await window.videoTool.startTranscription({ projectId, assetId: sourceAssetId, language });
      if (!response.ok) throw new Error(response.error.message);
      setJob(response.value);
      const generation = ++pollingGeneration.current;
      poll(response.value.id, generation, Date.now() + 65 * 60 * 1_000);
    } catch (error) {
      setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Could not start transcription.' });
    }
  };

  const cancel = async (): Promise<void> => {
    if (job === null) return;
    pollingGeneration.current += 1;
    const response = await window.videoTool.cancelTranscriptionJob(job.id);
    setJob((current) => current === null ? null : { ...current, status: 'cancelled' });
    setStatus(response.ok ? { tone: 'neutral', text: response.value.cancelled ? 'Transcription cancelled.' : 'The transcription job had already finished.' } : { tone: 'danger', text: response.error.message });
  };

  const editCue = (index: number, patch: Partial<SubtitleCue>): void => setDraft((current) => current === null ? null : ({
    ...current,
    status: 'draft',
    cues: current.cues.map((cue, at) => at === index ? { ...cue, ...patch } : cue)
  }));

  const save = async (approve: boolean): Promise<void> => {
    if (draft === null) return;
    try {
      const next = updateTranscriptionDraft(draft, draft.cues, approve);
      if (!await onSaveAi({ ...document, transcriptionDraft: next })) throw new Error('Could not save the transcript.');
      setDraft(next);
      setSavedDraft(next);
      setStatus({ tone: approve ? 'success' : 'neutral', text: approve ? 'Transcript approved. Applying it to the timeline remains a separate action.' : 'Transcript draft saved locally.' });
    } catch (error) {
      setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Could not save the transcript.' });
    }
  };

  const apply = (): void => {
    if (draft === null || draft.status !== 'approved' || dirty || sourceMissing || sourceNotPlaced) {
      setStatus({ tone: 'warning', text: sourceNotPlaced ? 'Place the transcript source asset on the timeline first.' : 'Save and approve the current transcript before applying captions.' });
      return;
    }
    setStatus(onApplyCaptions(draft)
      ? { tone: 'success', text: `${draft.cues.length} audio-aligned caption(s) added to the unsaved timeline. Review them in Editing, then save.` }
      : { tone: 'danger', text: 'The transcript could not be applied to the timeline.' });
  };

  const isRunning = job !== null && ['queued', 'normalizing', 'transcribing'].includes(job.status);
  return <fieldset className="subtitle-cue transcription-workflow">
    <legend>Automatic subtitles from audio or video</legend>
    <p className="studio-reference__empty">whisper.cpp runs locally. It first converts the selected project asset to mono 16 kHz audio, then returns timestamped segments for manual review.</p>
    <div className="writer-workspace__row">
      <label className="studio-field"><span className="studio-field__label">Source asset</span><select value={sourceAssetId} disabled={isRunning || sources.length === 0} onChange={(event) => setSourceAssetId(event.target.value)}>{sources.length ? sources.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName} ({asset.kind})</option>) : <option value="">Import an audio or video asset first</option>}</select></label>
      <label className="studio-field"><span className="studio-field__label">Spoken language</span><select value={language} disabled={isRunning} onChange={(event) => setLanguage(event.target.value)}>{LANGUAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
    </div>
    {runtimeLoading ? <StatusCard tone="neutral">Checking local whisper.cpp…</StatusCard> : runtime?.ready
      ? <StatusCard tone={runtime.checksumVerified ? 'success' : 'warning'}>{runtime.executableName} · {runtime.modelName}{runtime.checksumVerified ? ' · checksum verified' : ' · model checksum not configured'}</StatusCard>
      : <StatusCard tone="warning">{runtime?.reason ?? 'whisper.cpp is unavailable.'} <Button onClick={() => setRuntimeRevision((value) => value + 1)}>Retry</Button></StatusCard>}
    <div className="writer-preview__actions">
      <Button variant="primary" disabled={!runtime?.ready || !sourceAssetId || isRunning} onClick={() => void start()}>{isRunning ? `${job?.status ?? 'Working'} ${job?.progressPercent ?? 0}%` : 'Transcribe selected asset'}</Button>
      {isRunning && <Button onClick={() => void cancel()}>Cancel</Button>}
    </div>
    {sourceMissing && <StatusCard tone="danger">The transcript source asset is no longer in this project.</StatusCard>}
    {!sourceMissing && sourceNotPlaced && <StatusCard tone="warning">Place the transcript source asset on the timeline before applying captions. Trim, offset and speed will be mapped automatically.</StatusCard>}
    {draft !== null && <>
      <p className="studio-reference__empty">Draft from {draft.modelName} · {draft.language} · {draft.cues.length} cue(s). Editing any cue returns it to draft status.</p>
      <div className="subtitle-cue-list">{draft.cues.map((cue, index) => <fieldset key={cue.id} className="subtitle-cue"><legend>Transcript cue {index + 1}</legend>
        <div className="writer-workspace__row"><label className="studio-field"><span className="studio-field__label">Start ms</span><input type="number" value={cue.startMs} onChange={(event) => editCue(index, { startMs: Number(event.target.value) })} /></label><label className="studio-field"><span className="studio-field__label">End ms</span><input type="number" value={cue.endMs} onChange={(event) => editCue(index, { endMs: Number(event.target.value) })} /></label></div>
        <label className="studio-field"><span className="studio-field__label">Caption text</span><textarea rows={2} value={cue.text} onChange={(event) => editCue(index, { text: event.target.value })} /></label>
      </fieldset>)}</div>
      <div className="writer-preview__actions"><Button onClick={() => void save(false)}>Save transcript draft</Button><Button variant="primary" onClick={() => void save(true)}>Approve transcript</Button><Button disabled={draft.status !== 'approved' || dirty || sourceMissing || sourceNotPlaced} onClick={apply}>Apply audio-aligned captions</Button></div>
    </>}
    {status && <StatusCard tone={status.tone}>{status.text}</StatusCard>}
  </fieldset>;
}
