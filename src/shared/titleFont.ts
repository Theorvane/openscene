/**
 * Finding a font to draw titles with, and saying so when there is none.
 *
 * `drawtext` needs two things the desktop cannot assume: the filter itself,
 * which is only present when FFmpeg was built with libfreetype, and a font file
 * on disk. The app renders with whichever FFmpeg the user has, so both are
 * questions rather than facts.
 *
 * Kept here, without any file access of its own, so the rule can be tested and
 * the host does the looking.
 */

/** `ffmpeg -hide_banner -filters` lists what the build can do. */
export const FILTER_LIST_ARGS: readonly string[] = ['-hide_banner', '-filters'];

/** Whether that listing mentions the filter titles need. */
export function supportsDrawtext(filterListing: string): boolean {
  return /(^|\s)drawtext(\s|$)/m.test(filterListing);
}

/**
 * Where a font is likely to be, per platform.
 *
 * Ordered by how sure the bet is, and every candidate is a face that ships with
 * the system rather than one somebody might have installed. The host tries them
 * in turn and takes the first that exists; none existing is a refusal, not a
 * silent skip.
 */
export function fontCandidates(platform: string): readonly string[] {
  if (platform === 'darwin') {
    return ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'];
  }
  if (platform === 'win32') {
    return ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf', 'C:\\Windows\\Fonts\\tahoma.ttf'];
  }
  return [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf'
  ];
}

/**
 * FFmpeg reads the font path out of a filter string, where a backslash escapes
 * and a colon ends an option — so a Windows path has to be spelled for that
 * parser rather than for the filesystem.
 */
export function escapeFontPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:');
}
