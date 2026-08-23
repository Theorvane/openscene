import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import type { LocalExportJob } from '../../../shared/exportTypes';
import { outputFrameFor, type FramePreference } from '../../../shared/outputFrame';
import {
  DEFAULT_EXPORT_FRAME,
  EXPORT_FRAME_LABELS,
  EXPORT_FRAME_PREFERENCES,
  EXPORT_FRAME_STORAGE_KEY,
  parseExportFramePreferences,
  serializeExportFramePreferences
} from './exportFramePreference';
import { errorMessage, type StatusMessage } from '../appTypes';
import { Button, StatusCard } from '../ui';
import type { TimelineEditorController } from './useTimelineEditor';
import { getExportActionState, getExportStatusView } from './exportUiState';

type ExportPanelProps = {
  readonly editor: TimelineEditorController;
};

const EXPORT_POLL_INTERVAL_MS = 1_000;

function getActionStatus(responseMessage: string): StatusMessage {
  return { tone: 'danger', text: responseMessage };
}

/**
 * The remembered shape for a project, read and written where the editor's other
 * preferences live. A storage that refuses to answer is the default, not an
 * error: the worst that costs is exporting the shape the footage already is.
 */
function readFramePreference(projectId: string): FramePreference {
  if (typeof window === 'undefined') return DEFAULT_EXPORT_FRAME;
  try {
    return parseExportFramePreferences(window.localStorage.getItem(EXPORT_FRAME_STORAGE_KEY))[projectId] ?? DEFAULT_EXPORT_FRAME;
  } catch {
    return DEFAULT_EXPORT_FRAME;
  }
}

function writeFramePreference(projectId: string, preference: FramePreference): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = parseExportFramePreferences(window.localStorage.getItem(EXPORT_FRAME_STORAGE_KEY));
    window.localStorage.setItem(
      EXPORT_FRAME_STORAGE_KEY,
      serializeExportFramePreferences({ ...stored, [projectId]: preference })
    );
  } catch {
    // A preference that could not be saved still applies to this export.
  }
}

export function ExportPanel({ editor }: ExportPanelProps): ReactElement {
  const [job, setJob] = useState<LocalExportJob | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState('');
  const [actionStatus, setActionStatus] = useState<StatusMessage | null>(null);
  const project = editor.project;
  const hasProject = project !== null;
  const [framePreference, setFramePreference] = useState<FramePreference>(DEFAULT_EXPORT_FRAME);

  useEffect(() => {
    setFramePreference(project === null ? DEFAULT_EXPORT_FRAME : readFramePreference(project.id));
  }, [project?.id]);

  /*
    The frame this cut goes into, decided by the rule both surfaces share.

    The desktop used to take the first *asset* with dimensions on it, which is
    not the same question: the shared rule reads the timeline's leading clip, so
    a project that opens with its second import came out one shape here and
    another on a phone. Nothing about a project should depend on which app opened
    it.
  */
  const frame = useMemo(
    () =>
      project === null
        ? null
        : outputFrameFor({ timeline: project.timeline, assets: project.assets, preference: framePreference }),
    [framePreference, project]
  );
  const actionState = useMemo(
    () => getExportActionState({ hasProject, hasUnsavedTimeline: editor.hasUnsavedTimeline, isStarting, job }),
    [editor.hasUnsavedTimeline, hasProject, isStarting, job]
  );
  const statusView = useMemo(
    () => getExportStatusView({
      hasProject,
      hasUnsavedTimeline: editor.hasUnsavedTimeline,
      isStarting,
      job,
      unavailableReason
    }),
    [editor.hasUnsavedTimeline, hasProject, isStarting, job, unavailableReason]
  );

  useEffect(() => {
    if (!actionState.shouldPoll || job === null) return;

    const timeoutId = window.setTimeout(() => {
      void window.videoTool.getExportJob({ jobId: job.id }).then((response) => {
        if (response.ok) {
          setJob(response.value);
          return;
        }
        setActionStatus(getActionStatus(errorMessage(response.error)));
      });
    }, EXPORT_POLL_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [actionState.shouldPoll, job]);

  const startExport = useCallback(async (): Promise<void> => {
    if (project === null || !actionState.canStart) return;

    setIsStarting(true);
    setActionStatus(null);
    setUnavailableReason('');
    const response = await window.videoTool.startExportJob({
      projectId: project.id,
      // Sent explicitly: the main process falls back to the first video asset's
      // size, which is the answer this control exists to replace.
      ...(frame === null ? {} : { width: frame.width, height: frame.height })
    });
    setIsStarting(false);
    if (response.ok) {
      setJob(response.value);
      return;
    }
    setUnavailableReason(errorMessage(response.error));
  }, [actionState.canStart, frame, project]);

  const cancelExport = useCallback(async (): Promise<void> => {
    if (job === null || !actionState.canCancel) return;

    setIsCancelling(true);
    const response = await window.videoTool.cancelExportJob({ jobId: job.id });
    setIsCancelling(false);
    if (response.ok) {
      if (response.value.cancelled) {
        const refreshed = await window.videoTool.getExportJob({ jobId: job.id });
        if (refreshed.ok) setJob(refreshed.value);
      }
      setActionStatus({ tone: response.value.cancelled ? 'warning' : 'neutral', text: response.value.cancelled ? 'Export cancelled locally.' : 'Export was already finished.' });
      return;
    }
    setActionStatus(getActionStatus(errorMessage(response.error)));
  }, [actionState.canCancel, job]);

  const openExport = useCallback(async (): Promise<void> => {
    if (job === null || !actionState.canOpen) return;

    setIsOpening(true);
    const response = await window.videoTool.openExportResult({ jobId: job.id });
    setIsOpening(false);
    setActionStatus(response.ok
      ? { tone: 'success', text: 'Opened the exported MP4 in the local default app.' }
      : getActionStatus(errorMessage(response.error)));
  }, [actionState.canOpen, job]);

  const revealExport = useCallback(async (): Promise<void> => {
    if (job === null || !actionState.canReveal) return;

    setIsRevealing(true);
    const response = await window.videoTool.revealExportResult({ jobId: job.id });
    setIsRevealing(false);
    setActionStatus(response.ok
      ? { tone: 'success', text: 'Revealed the exported MP4 in the local file manager.' }
      : getActionStatus(errorMessage(response.error)));
  }, [actionState.canReveal, job]);

  const isExporting = actionState.canCancel;
  const triggerLabel = isExporting ? `Exporting ${statusView.progressValue}%` : 'Export';

  return (
    <section className="export-control" aria-labelledby="export-panel-title">
      <h2 id="export-panel-title" className="visually-hidden">MP4 export</h2>
      <Button
        className="export-control__trigger"
        variant="primary"
        aria-expanded={isPopoverOpen}
        aria-controls="export-popover"
        onClick={() => setIsPopoverOpen((open) => !open)}
      >
        {triggerLabel}
      </Button>
      {isPopoverOpen && (
        <div id="export-popover" className="export-popover" role="dialog" aria-label="MP4 export">
          <label className="export-panel__frame" htmlFor="export-frame">
            Frame
            <select
              id="export-frame"
              value={framePreference}
              disabled={!hasProject}
              onChange={(event) => {
                const next = event.target.value as FramePreference;
                setFramePreference(next);
                if (project !== null) writeFramePreference(project.id, next);
              }}
            >
              {EXPORT_FRAME_PREFERENCES.map((preference) => (
                <option key={preference} value={preference}>{EXPORT_FRAME_LABELS[preference]}</option>
              ))}
            </select>
            {/* Said in pixels, because "Portrait" is a choice and 1080 × 1920 is
                what the file will be. */}
            <span className="export-panel__frame-size">{frame === null ? '—' : `${frame.width} × ${frame.height}`}</span>
          </label>
          <div className="export-popover__actions" role="toolbar" aria-label="MP4 export actions">
            <Button variant="primary" onClick={() => void startExport()} disabled={!actionState.canStart || isStarting}>Export MP4</Button>
            <Button variant="stop" onClick={() => void cancelExport()} disabled={!actionState.canCancel || isCancelling}>Cancel</Button>
            <Button onClick={() => void openExport()} disabled={!actionState.canOpen || isOpening}>Open</Button>
            <Button onClick={() => void revealExport()} disabled={!actionState.canReveal || isRevealing}>Reveal</Button>
          </div>
          <StatusCard className="export-panel__status" tone={statusView.tone} aria-atomic="true">
            <strong>{statusView.title}</strong>
            <span>{statusView.detail}</span>
          </StatusCard>
          <label className="export-panel__progress-label" htmlFor="export-progress">
            Export progress
            <progress id="export-progress" max={100} value={statusView.progressValue} aria-valuetext={`${statusView.progressValue}%`} />
          </label>
          <p className="export-panel__boundary">Local-only FFmpeg export. The renderer receives job state and result actions only, never output paths or FFmpeg arguments.</p>
          {actionStatus !== null && <StatusCard className="export-panel__status" tone={actionStatus.tone}>{actionStatus.text}</StatusCard>}
        </div>
      )}
    </section>
  );
}
