import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * Two clips covering the same moment, on Android.
 *
 * The phone refused them by name: "Overlapping layers are not composited on
 * Android yet — put them on one track, or export on the desktop." Honest, and a
 * hole in the middle of a multi-track editor. The desktop composites with
 * `overlay` and iOS with layer instructions; Android built a single Media3
 * sequence, which plays one item after another by definition.
 *
 * A sequence is the wrong unit for a stack. A *layer* is the right one, and
 * `Composition` composites the sequences it is given — so the plan says which
 * layer a segment is in and Android builds one sequence per layer.
 */
describe('layered video on Android', () => {
  const readModule = () =>
    readFile(
      new URL('../mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt', import.meta.url),
      'utf8'
    );

  it('builds one sequence per layer rather than one for everything', async () => {
    const kotlin = await readModule();
    expect(kotlin).toContain('.groupBy { it.layer }');
    expect(kotlin).toContain('val videoSequences = video');
    // Bottom first, so the timeline's top row ends up on top — the same
    // stacking order the plan hands every renderer.
    expect(kotlin).toContain('.toSortedMap()');
  });

  it('no longer refuses a clip laid over another', async () => {
    const kotlin = await readModule();
    expect(kotlin).not.toContain('Overlapping layers are not composited on Android yet');
  });

  it('still refuses two clips of one layer covering the same moment', async () => {
    // Not a policy: a sequence plays its items in turn, so two clips of one
    // layer at one moment is a picture no renderer can draw. Refusing names it;
    // guessing would silently drop one from someone's cut.
    const kotlin = await readModule();
    expect(kotlin).toContain('private fun overlapsWithinALayer');
    expect(kotlin).toContain('Move one of them to a track of its own');
  });

  it('reads the layer off the plan rather than inferring it from timings', async () => {
    const kotlin = await readModule();
    expect(kotlin).toContain('layer = (it["layer"] as? Number)?.toInt() ?: 0');
    // And the bridge has to send it, or every segment lands in layer zero and
    // the refusal comes back for a timeline that is now legal.
    const bridge = await readFile(new URL('../mobile/src/lib/exportComposition.ts', import.meta.url), 'utf8');
    expect(bridge).toContain('layer: segment.layer');
  });
});
