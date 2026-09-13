import { describe, expect, it } from 'vitest';

import { ExportJobStore } from '../src/main/exportJobStore';

describe('export job store', () => {
  it('tracks queued, running progress, and completed states without storing an output path', () => {
    const timestamps = [
      new Date('2026-07-22T00:00:00.000Z'),
      new Date('2026-07-22T00:00:01.000Z'),
      new Date('2026-07-22T00:00:02.000Z'),
      new Date('2026-07-22T00:00:03.000Z')
    ];
    const store = new ExportJobStore({ createId: () => 'export_01', now: () => timestamps.shift() ?? new Date(0) });

    const queued = store.create('project_01');
    store.markRunning(queued.id, 2_000);
    store.updateProgress(queued.id, { processedMs: 500, durationMs: 2_000, ratio: 0.25 });
    const completed = store.markCompleted(queued.id, 'export_01.mp4', 1234, undefined, 'export_01.srt', 'export_01.provenance.json');

    expect(completed.state).toMatchObject({ kind: 'completed', fileName: 'export_01.mp4', fileSizeBytes: 1234, subtitleFileName: 'export_01.srt', provenanceFileName: 'export_01.provenance.json' });
    expect(JSON.stringify(completed)).not.toContain('/');
  });

  it('cancels only queued or running jobs and keeps terminal jobs terminal', () => {
    const store = new ExportJobStore({ createId: () => 'export_01' });
    const job = store.create('project_01');

    expect(store.cancel(job.id)).toBe(true);
    expect(store.get(job.id)?.state.kind).toBe('cancelled');
    expect(store.cancel(job.id)).toBe(false);
    expect(() => store.markRunning(job.id, 1_000)).toThrow('cannot transition');
  });
});
