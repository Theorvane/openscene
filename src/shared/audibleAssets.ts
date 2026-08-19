/**
 * Whether a file has sound, decided from what FFmpeg says rather than from what
 * an extension implies.
 *
 * A video clip's own audio is placed on export now, and `[i:a:0]` on a source
 * without an audio stream fails the whole graph — so "it is a video, therefore
 * it has sound" is not good enough. A silent recording is an ordinary thing to
 * have on a timeline and must not break the render.
 *
 * The probe is one FFmpeg invocation per asset that asks for the first audio
 * stream and decodes none of it. Exit zero means there was one to ask for.
 */

/** `ffmpeg -v error -i FILE -map 0:a:0 -t 0 -f null -` — cheap, and a plain yes or no. */
export function audioProbeArgs(assetPath: string): readonly string[] {
  return ['-v', 'error', '-i', assetPath, '-map', '0:a:0', '-t', '0', '-f', 'null', '-'];
}

/**
 * Absent audio is a "no", and so is a probe that failed for any other reason.
 *
 * Losing the sound of a file nothing could read costs a track that was already
 * unreachable; guessing yes costs the entire export.
 */
export function probeSaysAudible(exitCode: number | null): boolean {
  return exitCode === 0;
}
