import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVideoGenerationJob,
  getCompletedAiSource,
  getVideoGenerationJob,
  initializeVideoJobRecovery,
  setAiJobManagerBrowserVideoGenerator,
  setAiJobManagerVideoRecoveryStore
} from '../src/main/aiJobManager';
import {
  parseVideoJobJournal,
  VideoJobRecoveryStore,
  type PersistedVideoGenerationJob
} from '../src/main/videoJobRecoveryStore';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import {
  INTERRUPTED_VIDEO_JOB_ERROR,
  MISSING_VIDEO_JOB_ERROR,
  reconcileVideoCandidateAfterRestart,
  recoverVideoJobAfterRestart
} from '../src/shared/videoJobRecovery';

const runningJob: PersistedVideoGenerationJob = {
  id: 'video-job-recovery-01', provider: 'gemini_veo', mode: 'api', status: 'running',
  prompt: 'Private project prompt', operation: 'text_to_video', aspectRatio: '16:9', durationSeconds: 8,
  modelId: 'veo-3.1-generate-preview', outputFilePath: resolve('private', 'video-job-recovery-01.mp4'),
  createdAt: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:01:00.000Z'
};

afterEach(() => {
  setAiJobManagerVideoRecoveryStore(undefined);
  setAiJobManagerBrowserVideoGenerator(undefined);
  vi.restoreAllMocks();
});

describe('video generation crash recovery', () => {
  it('turns active work into an actionable terminal job without changing completed work', () => {
    const recovered = recoverVideoJobAfterRestart(runningJob, '2026-09-10T06:00:00.000Z');
    expect(recovered).toMatchObject({ status: 'failed', error: INTERRUPTED_VIDEO_JOB_ERROR, updatedAt: '2026-09-10T06:00:00.000Z' });
    expect(recoverVideoJobAfterRestart({ ...runningJob, status: 'completed' }, '2026-09-10T06:00:00.000Z')).toMatchObject({ status: 'completed' });
    expect(recoverVideoJobAfterRestart({
      ...runningJob,
      provider: 'grok_imagine',
      mode: 'browser_session',
      status: 'needs_user_action',
      actionRequired: 'sign_in',
      error: 'Sign in again, then start a new generation.'
    }, '2026-09-10T06:00:00.000Z')).toMatchObject({
      status: 'needs_user_action', actionRequired: 'sign_in', updatedAt: runningJob.updatedAt
    });
  });

  it('reconciles a stranded Writer candidate and never invents completion', () => {
    const base = createEmptyAiProjectDocument();
    const document = {
      ...base,
      generations: [{
        id: runningJob.id, shotId: 'shot-01', providerId: runningJob.provider, modelId: runningJob.modelId!,
        capability: 'text_to_video' as const, status: 'running' as const, prompt: runningJob.prompt,
        referenceAssetIds: [], outputAssetIds: [], createdAt: runningJob.createdAt, updatedAt: runningJob.updatedAt
      }]
    };
    const missing = reconcileVideoCandidateAfterRestart(document, runningJob.id, null, '2026-09-10T06:00:00.000Z');
    expect(missing.ok && missing.document.generations[0]).toMatchObject({ status: 'failed', error: MISSING_VIDEO_JOB_ERROR });
    const stillRunning = reconcileVideoCandidateAfterRestart(document, runningJob.id, runningJob, '2026-09-10T06:00:00.000Z');
    expect(stillRunning.ok && stillRunning.document).toBe(document);
    const needsAction = reconcileVideoCandidateAfterRestart(document, runningJob.id, {
      ...runningJob,
      provider: 'grok_imagine',
      mode: 'browser_session',
      status: 'needs_user_action',
      actionRequired: 'verification',
      error: 'Complete verification before starting a new generation.'
    }, '2026-09-10T06:00:00.000Z');
    expect(needsAction.ok && needsAction.document.generations[0]).toMatchObject({
      status: 'needs_user_action', error: 'Complete verification before starting a new generation.'
    });
  });

  it('round-trips Grok and typed browser intervention jobs while rejecting inconsistent action state', () => {
    const grokNeedsAction: PersistedVideoGenerationJob = {
      ...runningJob,
      provider: 'grok_imagine',
      mode: 'browser_session',
      status: 'needs_user_action',
      actionRequired: 'verification',
      error: 'Complete verification before starting a new generation.'
    };
    const payload = JSON.stringify({ schemaVersion: 1, jobs: [grokNeedsAction] });
    expect(parseVideoJobJournal(payload)).toEqual([grokNeedsAction]);
    expect(parseVideoJobJournal(JSON.stringify({
      schemaVersion: 1,
      jobs: [{ ...grokNeedsAction, status: 'failed' }]
    }))).toEqual([]);
    expect(parseVideoJobJournal(JSON.stringify({
      schemaVersion: 1,
      jobs: [{ ...grokNeedsAction, actionRequired: 'unknown_challenge' }]
    }))).toEqual([]);
    expect(parseVideoJobJournal(JSON.stringify({
      schemaVersion: 1,
      jobs: [{ ...grokNeedsAction, mode: 'api' }]
    }))).toEqual([]);
  });

  it('writes an atomic bounded journal and rejects corrupt or relative-path entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-job-recovery-'));
    try {
      const journalPath = join(root, 'video-jobs.json');
      const store = new VideoJobRecoveryStore(journalPath);
      await store.replace([runningJob]);
      expect(await store.load()).toEqual([runningJob]);
      expect(JSON.parse(await readFile(journalPath, 'utf8'))).toMatchObject({ schemaVersion: 1, jobs: [{ id: runningJob.id }] });
      await store.replace([{ ...runningJob, status: 'failed', error: INTERRUPTED_VIDEO_JOB_ERROR }]);
      expect(await store.load()).toMatchObject([{ status: 'failed', error: INTERRUPTED_VIDEO_JOB_ERROR }]);

      await writeFile(journalPath, JSON.stringify({
        schemaVersion: 1,
        jobs: [{ ...runningJob, id: 'relative-path', outputFilePath: '..\\escape.mp4' }]
      }));
      expect(await store.load()).toEqual([]);
      await writeFile(journalPath, '{not-json');
      expect(await store.load()).toEqual([]);
      expect(parseVideoJobJournal('{}')).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains only the newest jobs that fit the count and byte limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-job-recovery-'));
    try {
      const journalPath = join(root, 'video-jobs.json');
      const store = new VideoJobRecoveryStore(journalPath);
      const jobs = Array.from({ length: 220 }, (_, index): PersistedVideoGenerationJob => ({
        ...runningJob,
        id: `bounded-${index.toString().padStart(3, '0')}`,
        prompt: `${index}:`.padEnd(100_000, 'x'),
        updatedAt: new Date(Date.UTC(2026, 8, 10, 5, index)).toISOString()
      }));

      await store.replace(jobs);
      const persistedBytes = Buffer.byteLength(await readFile(journalPath, 'utf8'), 'utf8');
      const loaded = await store.load();
      expect(persistedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(loaded.length).toBeLessThanOrEqual(200);
      expect(loaded[0]?.id).toBe('bounded-219');
      expect(loaded.some((job) => job.id === 'bounded-000')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hydrates the main-process map before IPC and persists interrupted state without exposing its path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-job-recovery-'));
    try {
      const store = new VideoJobRecoveryStore(join(root, 'video-jobs.json'));
      await store.replace([runningJob]);
      await initializeVideoJobRecovery(store);

      const recovered = getVideoGenerationJob(runningJob.id);
      expect(recovered).toMatchObject({ status: 'failed', error: INTERRUPTED_VIDEO_JOB_ERROR });
      expect(recovered).not.toHaveProperty('outputFilePath');
      expect((await store.load())[0]).toMatchObject({ status: 'failed', error: INTERRUPTED_VIDEO_JOB_ERROR });
    } finally {
      setAiJobManagerVideoRecoveryStore(undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores a completed output only when its confined local file still exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-job-recovery-'));
    try {
      const videoDirectory = join(root, 'video');
      const outputFilePath = join(videoDirectory, 'completed.mp4');
      const store = new VideoJobRecoveryStore(join(root, 'video-jobs.json'));
      await mkdir(videoDirectory, { recursive: true });
      await writeFile(outputFilePath, Buffer.from('non-empty-mp4-fixture'));
      await store.replace([{ ...runningJob, status: 'completed', outputFilePath }]);

      await initializeVideoJobRecovery(store, {
        videoDirectory,
        now: () => new Date('2026-09-10T06:00:00.000Z')
      });

      const recovered = getVideoGenerationJob(runningJob.id);
      expect(recovered).toMatchObject({ status: 'completed' });
      expect(recovered?.previewUrl).toContain('video-preview');
      expect(recovered).not.toHaveProperty('outputFilePath');
      expect(getCompletedAiSource(runningJob.id)?.sourcePath).toBe(outputFilePath);
    } finally {
      setAiJobManagerVideoRecoveryStore(undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not start a provider request when the queued state cannot be journaled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-job-recovery-'));
    try {
      const store = new VideoJobRecoveryStore(join(root, 'video-jobs.json'));
      vi.spyOn(store, 'replace').mockRejectedValue(new Error('disk unavailable'));
      const provider = vi.fn(async () => ({ bytes: Buffer.from('video'), providerJobId: 'must-not-run' }));
      setAiJobManagerVideoRecoveryStore(store);
      setAiJobManagerBrowserVideoGenerator(provider);

      await expect(createVideoGenerationJob({
        prompt: 'Do not submit this request', aspectRatio: '16:9', durationSeconds: 4,
        modelId: 'gemini-omni-1.1-flash', mode: 'browser_session'
      })).rejects.toThrow('was not submitted');
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(provider).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
