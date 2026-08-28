import { randomUUID } from 'node:crypto';

import type { ExportReview } from '../shared/exportReview';
import type { ExportJobState, ExportProgress, LocalExportJob } from '../shared/exportTypes';

type ExportJobStoreDependencies = {
  readonly createId?: () => string;
  readonly now?: () => Date;
};

export class ExportJobStoreError extends Error {
  override readonly name = 'ExportJobStoreError';
}

export class ExportJobStore {
  private readonly jobs = new Map<string, LocalExportJob>();
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(dependencies: ExportJobStoreDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  create(projectId: string): LocalExportJob {
    const id = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
      throw new ExportJobStoreError('Generated export job ID was not safe.');
    }
    const timestamp = this.now().toISOString();
    const job: LocalExportJob = {
      id,
      projectId,
      state: { kind: 'queued', queuedAt: timestamp },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.jobs.set(id, job);
    return job;
  }

  get(jobId: string): LocalExportJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  markRunning(jobId: string, durationMs: number): LocalExportJob {
    const job = this.requireState(jobId, ['queued']);
    return this.replace(job, {
      kind: 'running',
      startedAt: this.now().toISOString(),
      progress: { processedMs: 0, durationMs, ratio: 0 }
    });
  }

  updateProgress(jobId: string, progress: ExportProgress): LocalExportJob {
    const job = this.jobs.get(jobId);
    if (job === undefined || job.state.kind !== 'running') {
      throw new ExportJobStoreError('Export job cannot receive progress unless it is running.');
    }
    if (progress.durationMs !== job.state.progress.durationMs || progress.processedMs < job.state.progress.processedMs) {
      return job;
    }
    return this.replace(job, { ...job.state, progress });
  }

  markCompleted(jobId: string, fileName: string, fileSizeBytes: number, review?: ExportReview): LocalExportJob {
    const job = this.requireState(jobId, ['running']);
    return this.replace(job, {
      kind: 'completed',
      completedAt: this.now().toISOString(),
      fileName,
      fileSizeBytes,
      // Carried only when there is one: a caller with nothing to report should
      // not have to invent an "unchecked" review to say so.
      ...(review === undefined ? {} : { review })
    });
  }

  markFailed(jobId: string, reason: string): LocalExportJob {
    const job = this.requireState(jobId, ['queued', 'running']);
    return this.replace(job, { kind: 'failed', failedAt: this.now().toISOString(), reason });
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job === undefined || (job.state.kind !== 'queued' && job.state.kind !== 'running')) {
      return false;
    }
    this.replace(job, { kind: 'cancelled', cancelledAt: this.now().toISOString() });
    return true;
  }

  private requireState(jobId: string, allowed: readonly ExportJobState['kind'][]): LocalExportJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new ExportJobStoreError('Export job was not found.');
    }
    if (!allowed.includes(job.state.kind)) {
      throw new ExportJobStoreError(`Export job in state "${job.state.kind}" cannot transition.`);
    }
    return job;
  }

  private replace(job: LocalExportJob, state: ExportJobState): LocalExportJob {
    const updated = { ...job, state, updatedAt: this.now().toISOString() };
    this.jobs.set(job.id, updated);
    return updated;
  }
}
