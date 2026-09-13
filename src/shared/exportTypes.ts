import type { ExportReview } from './exportReview';
import type { MetadataPrivacyMode, MetadataPrivacyVerification } from './metadataPrivacy';
import type { SubtitleDelivery } from './subtitleDelivery';

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
  /** Absent preserves pre-caption export behavior: burn timeline captions and create no sidecar. */
  readonly subtitleDelivery?: SubtitleDelivery;
  /** Absent preserves container metadata for backward compatibility. */
  readonly metadataPrivacyMode?: MetadataPrivacyMode;
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
      readonly subtitleFileName?: string;
      readonly provenanceFileName?: string;
      /** Actual allowlisted tag-name inventory; never contains metadata values or paths. */
      readonly metadataPrivacyVerification?: MetadataPrivacyVerification;
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
