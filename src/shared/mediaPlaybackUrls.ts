export const MEDIA_PLAYBACK_SCHEME = 'video-tool-asset';

/** A path-free URL whose job id is resolved and validated again in the main process. */
export function speechPreviewUrl(jobId: string): string {
  return `${MEDIA_PLAYBACK_SCHEME}://speech-preview/${encodeURIComponent(jobId)}`;
}

/** A path-free URL for reviewing a generated video before project import. */
export function videoPreviewUrl(jobId: string): string {
  return `${MEDIA_PLAYBACK_SCHEME}://video-preview/${encodeURIComponent(jobId)}`;
}
