import { describe, expect, it } from 'vitest';

import { upsertGenerationJob } from '../src/shared/generationJobList';

describe('generation job rows', () => {
  it('keeps the newest state for a job when submission and recovery overlap', () => {
    const jobs = [{ id: 'job-1', status: 'queued' }, { id: 'job-2', status: 'running' }];
    expect(upsertGenerationJob(jobs, { id: 'job-1', status: 'running' })).toEqual([
      { id: 'job-1', status: 'running' },
      { id: 'job-2', status: 'running' }
    ]);
  });

  it('removes duplicate rows already present in an older list', () => {
    expect(upsertGenerationJob([{ id: 'job-1' }, { id: 'job-1' }], { id: 'job-2' }).map((job) => job.id)).toEqual(['job-2', 'job-1']);
  });

  it('does not reorder other jobs when a polling update arrives', () => {
    expect(upsertGenerationJob([{ id: 'job-2' }, { id: 'job-1' }], { id: 'job-1' }).map((job) => job.id)).toEqual(['job-2', 'job-1']);
  });
});
