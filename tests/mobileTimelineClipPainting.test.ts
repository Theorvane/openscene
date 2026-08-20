import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * Where the clip's rounded corners are clipped, and why it matters.
 *
 * `overflow: 'hidden'` on the clip container is the obvious place for it. It
 * also stopped the clip's children from painting after any *other* clip
 * re-rendered: frames and label gone, a bare coloured block left behind, and
 * the children still present in the view tree. Touching that clip brought it
 * back and blanked the one before it — one clip drawn at a time, which is the
 * opposite of what a filmstrip is for.
 *
 * A style assertion is weak evidence, and it is the only kind available here:
 * nothing in this suite renders Android views. What it buys is that the next
 * person to reach for `overflow: 'hidden'` on the container reads why it is not
 * there, rather than rediscovering it by watching a timeline go blank.
 */

const read = () =>
  readFile(new URL('../mobile/src/components/TimelineClip.tsx', import.meta.url), 'utf8');

/**
 * The body of one `StyleSheet.create` entry, by name, without its comments.
 *
 * Comments are stripped because the `clip` block explains *why* it does not set
 * `overflow: 'hidden'` — and a check that reads the explanation as the thing it
 * forbids is a check that fails for saying the right thing.
 */
function styleBlock(source: string, name: string): string {
  const start = source.indexOf(`  ${name}: {`);
  if (start === -1) throw new Error(`no style named ${name}`);
  return source
    .slice(start, source.indexOf('\n  },', start))
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('a clip on the phone timeline', () => {
  it('clips the strip rather than the clip', async () => {
    const source = await read();
    expect(styleBlock(source, 'filmstrip')).toContain("overflow: 'hidden'");
    expect(styleBlock(source, 'clip')).not.toContain("overflow: 'hidden'");
  });

  it('keeps the rounded corners the clipping was there for', async () => {
    const source = await read();
    expect(styleBlock(source, 'filmstrip')).toContain('borderRadius');
    expect(styleBlock(source, 'clip')).toContain('borderRadius');
  });

  it('holds the label in by layout, since nothing clips it now', async () => {
    // A long filename must not spill over the next clip: the text is a flex
    // child of a fixed-width container and truncates instead.
    expect(await read()).toContain('numberOfLines={1}');
  });
});
