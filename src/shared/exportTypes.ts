import type { ExportReview } from './exportReview';

export const EXPORT_DEFAULTS = {
  width: 1920,
  height: 1080,
  frameRate: 30
} as const;

export type StartExportJobInput = {
  readonly projectId: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
};

export type ExportJobActionInput = {
  readonly jobId: string;
};

export type LocalFfmpegRuntimeStatus =
  | { readonly kind: 'configured' }
  | { readonly kind: 'system' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type ExportProgress = {
  readonly processedMs: number;
  readonly durationMs: number;
  readonly ratio: number;
};

export type ExportJobState =
  | { readonly kind: 'queued'; readonly queuedAt: string }
  | { readonly kind: 'running'; readonly startedAt: string; readonly progress: ExportProgress }
  | {
      readonly kind: 'completed';
      readonly completedAt: string;
      readonly fileName: string;
      readonly fileSizeBytes: number;
      /**
       * What the finished file turned out to be, read back off the file.
       *
       * Optional because a machine without FFprobe cannot answer, and an
       * unchecked export is not a failed one — see `reviewExport`.
       */
      readonly review?: ExportReview;
    }
  | { readonly kind: 'cancelled'; readonly cancelledAt: string }
  | { readonly kind: 'failed'; readonly failedAt: string; readonly reason: string };

export type LocalExportJob = {
  readonly id: string;
  readonly projectId: string;
  readonly state: ExportJobState;
  readonly createdAt: string;
  readonly updatedAt: string;
};
