import { useState, type ReactElement } from 'react';

import { formatBytes, formatDuration, formatTimestamp } from './format';
import { useProjectResultImport } from './ProjectResultImportContext';
import { useCaptureRecorder } from './useCaptureRecorder';
import type { StatusMessage } from './appTypes';

export function CaptureWorkspace(): ReactElement {
  const capture = useCaptureRecorder();
  const projectImport = useProjectResultImport();
  const [importStatus, setImportStatus] = useState<StatusMessage | null>(null);

  const importRecordingResult = async (): Promise<void> => {
    if (capture.result === null) return;
    setImportStatus({ tone: 'neutral', text: 'Importing recording into the active project.' });
    setImportStatus(await projectImport.importRecordingResult(capture.result.sessionId));
  };

  return (
    <section className="workspace-grid" aria-label="Recording workspace">
      <aside className="source-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Source picker</p>
            <h2>Capturable windows</h2>
          </div>
          <button className="button button--ghost" type="button" onClick={() => void capture.refreshSources()} disabled={capture.isLoadingSources || capture.canStop}>
            {capture.isLoadingSources ? 'Scanning' : 'Refresh'}
          </button>
        </div>

        <div className="permission-card">
          <span className="permission-card__label">Screen permission</span>
          <strong>{capture.settings?.screenPermission ?? 'checking'}</strong>
          <small>Recordings stay local and are managed by OpenScene.</small>
        </div>

        <div className="source-list" role="listbox" aria-label="Capturable window list">
          {capture.sources.map((source) => (
            <button
              className={`source-card${capture.selectedSource?.id === source.id ? ' source-card--selected' : ''}`}
              key={`${source.generation}:${source.id}`}
              type="button"
              onClick={() => void capture.selectSource(source)}
              disabled={capture.canStop || capture.workflowState === 'finalizing'}
              role="option"
              aria-selected={capture.selectedSource?.id === source.id}
            >
              <span className="source-card__thumb">
                {source.thumbnailDataUrl === undefined ? <span className="source-card__fallback">No thumbnail</span> : <img src={source.thumbnailDataUrl} alt="" />}
              </span>
              <span className="source-card__body">
                <strong>{source.name}</strong>
                <small>{source.appName}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="recorder-panel">
        <div className="recorder-panel__topline">
          <div>
            <p className="section-kicker">Preview</p>
            <h2>{capture.selectedSource?.name ?? 'Choose a window'}</h2>
            <span>{capture.selectedSourceSubtitle}</span>
          </div>
          <div className={`state-pill state-pill--${capture.workflowState}`}>{capture.workflowState.replace('_', ' ')}</div>
        </div>

        <div className="preview-frame">
          <video ref={capture.videoRef} muted playsInline />
          {capture.selectedSource === null && <div className="preview-frame__empty">Refresh and choose a window to arm exact-source preview.</div>}
        </div>

        <div className="transport-strip" aria-label="Recording controls">
          <div className="timer-block">
            <span>Elapsed</span>
            <strong>{formatDuration(capture.elapsedMs)}</strong>
          </div>
          <div className="transport-strip__buttons">
            <button className="button button--record" type="button" onClick={() => void capture.startRecording()} disabled={!capture.canRecord}>Record</button>
            <button className="button" type="button" onClick={capture.pauseRecording} disabled={!capture.canPause}>Pause</button>
            <button className="button" type="button" onClick={capture.resumeRecording} disabled={!capture.canResume}>Resume</button>
            <button className="button button--stop" type="button" onClick={capture.stopRecording} disabled={!capture.canStop}>Stop</button>
            <button className="button button--ghost" type="button" onClick={() => void capture.abortActiveRecording()} disabled={capture.session === null}>Discard</button>
          </div>
        </div>

        <div className={`status-card status-card--${capture.statusMessage.tone}`} role="status">
          {capture.statusMessage.text}
        </div>

        {capture.result !== null && (
          <section className="result-card" aria-labelledby="result-title">
            <div>
              <p className="section-kicker">Export result</p>
              <h3 id="result-title">{capture.result.fileName}</h3>
            </div>
            <dl>
              <div><dt>Size</dt><dd>{formatBytes(capture.result.fileSizeBytes)}</dd></div>
              <div><dt>Duration</dt><dd>{formatDuration(capture.result.durationMs)}</dd></div>
              <div><dt>Created</dt><dd>{formatTimestamp(capture.result.createdAt)}</dd></div>
              <div><dt>Project</dt><dd>{projectImport.activeProject?.name ?? 'Open a project to import'}</dd></div>
            </dl>
            <div className="result-card__actions">
              <button className="button button--primary" type="button" onClick={() => void importRecordingResult()} disabled={projectImport.activeProject === null || projectImport.isImporting} aria-label="Import completed recording into the active timeline project">Import to project</button>
              <button className="button button--primary" type="button" onClick={() => void capture.openResult()}>Open file</button>
              <button className="button" type="button" onClick={() => void capture.revealResult()}>Reveal in Finder</button>
            </div>
            {importStatus !== null && <div className={`status-card status-card--${importStatus.tone}`} role="status" aria-live="polite">{importStatus.text}</div>}
          </section>
        )}
      </section>
    </section>
  );
}
