import { exportReviewSummary } from '../../../shared/exportReview';
import type { LocalExportJob } from '../../../shared/exportTypes';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

type ExportUiInput = {
  readonly hasProject: boolean;
  readonly hasUnsavedTimeline: boolean;
  readonly isStarting: boolean;
  readonly job: LocalExportJob | null;
  readonly unavailableReason?: string;
};

export type ExportActionState = {
  readonly canCancel: boolean;
  readonly canOpen: boolean;
  readonly canReveal: boolean;
  readonly canStart: boolean;
  readonly shouldPoll: boolean;
};

export type ExportStatusView = {
  readonly detail: string;
  readonly progressValue: number;
  readonly title: string;
  readonly tone: StatusTone;
};

function formatExportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function isExportJobActive(job: LocalExportJob | null): boolean {
  return job?.state.kind === 'queued' || job?.state.kind === 'running';
}

export function getExportProgressPercent(job: LocalExportJob | null): number {
  if (job?.state.kind === 'completed') return 100;
  if (job?.state.kind !== 'running') return 0;

  return Math.max(0, Math.min(100, Math.round(job.state.progress.ratio * 100)));
}

export function getExportActionState(input: ExportUiInput): ExportActionState {
  const active = isExportJobActive(input.job);
  const completed = input.job?.state.kind === 'completed';

  return {
    canCancel: active,
    canOpen: completed,
    canReveal: completed,
    canStart: input.hasProject && !input.hasUnsavedTimeline && !input.isStarting && !active,
    shouldPoll: active
  };
}

export function getExportStatusView(input: ExportUiInput): ExportStatusView {
  if (input.unavailableReason !== undefined && input.unavailableReason.length > 0) {
    return {
      detail: input.unavailableReason,
      progressValue: 0,
      title: 'Export unavailable',
      tone: 'danger'
    };
  }

  if (!input.hasProject) {
    return {
      detail: 'Open a local project before starting an MP4 export.',
      progressValue: 0,
      title: 'Waiting for project',
      tone: 'neutral'
    };
  }

  if (input.hasUnsavedTimeline) {
    return {
      detail: 'Save the timeline first so the authoritative export uses the current edit.',
      progressValue: 0,
      title: 'Save required',
      tone: 'warning'
    };
  }

  if (input.isStarting) {
    return {
      detail: 'Checking the local FFmpeg runtime and preparing project media.',
      progressValue: 0,
      title: 'Preparing export',
      tone: 'warning'
    };
  }

  if (input.job === null) {
    return {
      detail: 'Ready to render a local MP4 with H.264 video and AAC audio.',
      progressValue: 0,
      title: 'Export available',
      tone: 'success'
    };
  }

  switch (input.job.state.kind) {
    case 'queued':
      return {
        detail: 'Queued locally. Export will start when the FFmpeg worker is ready.',
        progressValue: 0,
        title: 'Export queued',
        tone: 'warning'
      };
    case 'running': {
      const percent = getExportProgressPercent(input.job);
      return {
        detail: `${percent}% complete. Rendering MP4 H.264/AAC locally.`,
        progressValue: percent,
        title: 'Export running',
        tone: 'warning'
      };
    }
    case 'completed': {
      /*
        A finished file that does not match the cut is not a success with a
        note attached. Every truncated or silent export this project has
        shipped also ended with a written file and a zero exit, so what the
        file measures leads here rather than trailing the size.
      */
      const review = input.job.state.review;
      const ready = `${input.job.state.fileName} is ready. Size: ${formatExportBytes(input.job.state.fileSizeBytes)}.`;
      if (review !== undefined && review.checked && !review.ok) {
        return {
          detail: `${exportReviewSummary(review)} ${ready}`,
          progressValue: 100,
          title: 'Export does not match the cut',
          tone: 'danger'
        };
      }
      return {
        detail: review === undefined || review.checked ? ready : `${ready} ${exportReviewSummary(review)}`,
        progressValue: 100,
        title: 'Export complete',
        tone: 'success'
      };
    }
    case 'cancelled':
      return {
        detail: 'The local MP4 export was cancelled and the partial output was discarded.',
        progressValue: 0,
        title: 'Export cancelled',
        tone: 'neutral'
      };
    case 'failed':
      return {
        detail: input.job.state.reason,
        progressValue: 0,
        title: 'Export failed',
        tone: 'danger'
      };
  }
}
