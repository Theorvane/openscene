import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { VIDEO_OPERATIONS } from '../shared/mediaCapabilityRegistry';
import { BROWSER_GENERATION_ACTIONS, type VideoGenerationJob, type VideoGenerationProviderId } from '../shared/providerSeams';

const VIDEO_JOB_JOURNAL_SCHEMA_VERSION = 1;
const MAXIMUM_RETAINED_VIDEO_JOBS = 200;
const MAXIMUM_JOURNAL_BYTES = 4 * 1024 * 1024;
const PROVIDERS: readonly VideoGenerationProviderId[] = [
  'gemini_veo', 'gemini_omni', 'grok_imagine', 'openai_sora', 'runway_gen4', 'kling_v3',
  'luma_dream', 'minimax_hailuo', 'comfyui_wan'
];
const STATUSES = ['queued', 'running', 'needs_user_action', 'completed', 'failed'] as const;
const MODES = ['api', 'browser_session', 'local'] as const;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;

export type PersistedVideoGenerationJob = VideoGenerationJob & {
  /** Main-process only; never returned over IPC or MCP. */
  outputFilePath?: string;
};

type VideoJobJournal = {
  readonly schemaVersion: typeof VIDEO_JOB_JOURNAL_SCHEMA_VERSION;
  readonly jobs: readonly PersistedVideoGenerationJob[];
};

function boundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.length > 0);
}

function validIsoDate(value: unknown): value is string {
  return boundedString(value, 64) && Number.isFinite(Date.parse(value));
}

function optionalBoundedString(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || boundedString(value, maximum, true);
}

export function parsePersistedVideoJob(value: unknown): PersistedVideoGenerationJob | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const job = value as Record<string, unknown>;
  if (
    !boundedString(job.id, 160) ||
    !PROVIDERS.includes(job.provider as VideoGenerationProviderId) ||
    !MODES.includes(job.mode as (typeof MODES)[number]) ||
    !STATUSES.includes(job.status as (typeof STATUSES)[number]) ||
    !boundedString(job.prompt, 100_000, true) ||
    !ASPECT_RATIOS.includes(job.aspectRatio as (typeof ASPECT_RATIOS)[number]) ||
    typeof job.durationSeconds !== 'number' || !Number.isFinite(job.durationSeconds) || job.durationSeconds <= 0 || job.durationSeconds > 300 ||
    !validIsoDate(job.createdAt) || !validIsoDate(job.updatedAt) ||
    !optionalBoundedString(job.stylePreset, 500) ||
    !optionalBoundedString(job.providerJobId, 1_000) ||
    !optionalBoundedString(job.modelId, 500) ||
    !optionalBoundedString(job.outputAssetId, 160) ||
    !optionalBoundedString(job.error, 10_000) ||
    (job.actionRequired !== undefined && !BROWSER_GENERATION_ACTIONS.includes(job.actionRequired as (typeof BROWSER_GENERATION_ACTIONS)[number])) ||
    ((job.status === 'needs_user_action') !== (job.actionRequired !== undefined)) ||
    (job.status === 'needs_user_action' && job.mode !== 'browser_session') ||
    (job.operation !== undefined && !VIDEO_OPERATIONS.includes(job.operation as (typeof VIDEO_OPERATIONS)[number])) ||
    (job.outputFilePath !== undefined && (!boundedString(job.outputFilePath, 32_768) || !isAbsolute(job.outputFilePath)))
  ) return null;

  return {
    id: job.id,
    provider: job.provider as VideoGenerationProviderId,
    mode: job.mode as PersistedVideoGenerationJob['mode'],
    status: job.status as PersistedVideoGenerationJob['status'],
    prompt: job.prompt,
    aspectRatio: job.aspectRatio as PersistedVideoGenerationJob['aspectRatio'],
    durationSeconds: job.durationSeconds,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.operation === undefined ? {} : { operation: job.operation as Exclude<PersistedVideoGenerationJob['operation'], undefined> }),
    ...(job.stylePreset === undefined ? {} : { stylePreset: job.stylePreset as string }),
    ...(job.providerJobId === undefined ? {} : { providerJobId: job.providerJobId as string }),
    ...(job.modelId === undefined ? {} : { modelId: job.modelId as string }),
    ...(job.outputAssetId === undefined ? {} : { outputAssetId: job.outputAssetId as string }),
    ...(job.outputFilePath === undefined ? {} : { outputFilePath: resolve(job.outputFilePath as string) }),
    ...(job.actionRequired === undefined ? {} : { actionRequired: job.actionRequired as NonNullable<PersistedVideoGenerationJob['actionRequired']> }),
    ...(job.error === undefined ? {} : { error: job.error as string })
  };
}

export function parseVideoJobJournal(text: string): readonly PersistedVideoGenerationJob[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
    const journal = raw as { schemaVersion?: unknown; jobs?: unknown };
    if (journal.schemaVersion !== VIDEO_JOB_JOURNAL_SCHEMA_VERSION || !Array.isArray(journal.jobs)) return [];
    const jobs = journal.jobs
      .map(parsePersistedVideoJob)
      .filter((job): job is PersistedVideoGenerationJob => job !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const unique = new Map<string, PersistedVideoGenerationJob>();
    for (const job of jobs) {
      if (!unique.has(job.id)) unique.set(job.id, job);
    }
    return [...unique.values()]
      .slice(0, MAXIMUM_RETAINED_VIDEO_JOBS);
  } catch {
    return [];
  }
}

function jobsWithinJournalLimit(jobs: readonly PersistedVideoGenerationJob[]): readonly PersistedVideoGenerationJob[] {
  const ordered = [...jobs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAXIMUM_RETAINED_VIDEO_JOBS);
  const kept: PersistedVideoGenerationJob[] = [];
  let bytes = Buffer.byteLength(`{"schemaVersion":${VIDEO_JOB_JOURNAL_SCHEMA_VERSION},"jobs":[]}`, 'utf8') + 1;
  for (const job of ordered) {
    const jobBytes = Buffer.byteLength(JSON.stringify(job), 'utf8') + (kept.length === 0 ? 0 : 1);
    if (bytes + jobBytes > MAXIMUM_JOURNAL_BYTES) continue;
    kept.push(job);
    bytes += jobBytes;
  }
  return kept;
}

export class VideoJobRecoveryStore {
  private work: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<readonly PersistedVideoGenerationJob[]> {
    try {
      const file = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stats = await file.stat();
        if (!stats.isFile() || stats.size > MAXIMUM_JOURNAL_BYTES) return [];
        return parseVideoJobJournal(await file.readFile('utf8'));
      } finally {
        await file.close();
      }
    } catch {
      return [];
    }
  }

  replace(jobs: readonly PersistedVideoGenerationJob[]): Promise<void> {
    const operation = this.work.then(() => this.write(jobs), () => this.write(jobs));
    this.work = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async write(jobs: readonly PersistedVideoGenerationJob[]): Promise<void> {
    const retained = jobsWithinJournalLimit(jobs);
    const payload: VideoJobJournal = { schemaVersion: VIDEO_JOB_JOURNAL_SCHEMA_VERSION, jobs: retained };
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(directory, `.video-generation-jobs.${randomUUID()}.tmp`);
    let temporary: FileHandle | undefined;
    try {
      temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await temporary.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
      await temporary.sync();
      await temporary.close();
      temporary = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await temporary?.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
