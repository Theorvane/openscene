import type { AiProjectDocument } from './aiProjectDomain';
import { updateGenerationCandidate, type GenerationReviewResult } from './generationReview';
import type { VideoGenerationJob } from './providerSeams';

export const INTERRUPTED_VIDEO_JOB_ERROR =
  'Generation was interrupted when OpenScene stopped. It was not submitted again automatically; check the provider before starting another paid request.';

export const MISSING_VIDEO_JOB_ERROR =
  'The local generation job record is unavailable after restart. OpenScene did not submit another provider request.';

/**
 * A provider request cannot safely be replayed after a process dies: it may
 * already have charged and completed remotely. Recovery therefore preserves
 * terminal states and turns active states into an actionable terminal record.
 */
export function recoverVideoJobAfterRestart(job: VideoGenerationJob, recoveredAt: string): VideoGenerationJob {
  if (job.status !== 'queued' && job.status !== 'running') return job;
  return {
    ...job,
    status: 'failed',
    error: INTERRUPTED_VIDEO_JOB_ERROR,
    updatedAt: recoveredAt
  };
}

/** Reconciles the project-owned candidate with the recovered main-process job. */
export function reconcileVideoCandidateAfterRestart(
  document: AiProjectDocument,
  generationId: string,
  job: VideoGenerationJob | null,
  recoveredAt: string
): GenerationReviewResult {
  const candidate = document.generations.find((entry) => entry.id === generationId);
  if (candidate === undefined) return { ok: false, reason: 'The generation attempt is no longer in this project.' };
  if (candidate.status !== 'queued' && candidate.status !== 'running') return { ok: true, document };
  if (job === null) {
    return updateGenerationCandidate(document, generationId, {
      status: 'failed',
      error: MISSING_VIDEO_JOB_ERROR,
      updatedAt: recoveredAt
    });
  }
  if (job.status === 'queued' || job.status === 'running') return { ok: true, document };
  return updateGenerationCandidate(document, generationId, {
    status: job.status,
    ...(job.error === undefined ? {} : { error: job.error }),
    updatedAt: job.updatedAt
  });
}
