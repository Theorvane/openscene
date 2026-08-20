import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That what Adjust changes is what gets rendered.
 *
 * Opacity, scale, position and rotation are computed by the shared plan and
 * honoured by the desktop, and on mobile they were dropped three times over:
 * the preview never received them, the export bridge stripped them before the
 * native module, and neither native module applied them. Someone setting a clip
 * to 10% opacity saw a fully opaque picture and reasonably concluded the control
 * was broken.
 *
 * Each of the three places is asserted separately, because fixing one and
 * leaving another is exactly how this survived the first time.
 */

const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

describe('the preview', () => {
  it('applies what Adjust set', async () => {
    const player = await read('src/components/PreviewPlayer.tsx');
    expect(player).toContain('effects.scale');
    expect(player).toContain('effects.rotation');
    expect(player).toContain('effects.positionX');
  });

  it('composites opacity as a scrim rather than a style', async () => {
    // An Android video surface does not composite alpha, so `opacity` on the
    // view leaves the picture solid — which is what made the control look
    // broken. Black at the complementary alpha is what the export does anyway.
    const player = await read('src/components/PreviewPlayer.tsx');
    expect(player).toContain('const dim =');
    expect(player).toContain('styles.scrim');
  });

  it('clips a scaled frame instead of letting it paint over the app', async () => {
    const player = await read('src/components/PreviewPlayer.tsx');
    expect(player).toMatch(/root: \{[^}]*overflow: 'hidden'/);
  });

  it('is given the effects by the editor', async () => {
    const screen = await read('src/screens/EditScreen.tsx');
    // The clip's own opacity reaches the preview. It is multiplied by the
    // transition ramp now, which is why this matches a prefix rather than a
    // whole line — what must not happen is the value being dropped.
    expect(screen).toContain('visible.clip.effects.opacity');
  });
});

describe('the export bridge', () => {
  it('forwards the effects rather than dropping them', async () => {
    const bridge = await read('src/lib/exportComposition.ts');
    expect(bridge).toContain('rotationDegrees: segment.rotationDegrees');
    expect(bridge).toContain('videoSegments: plan.videoSegments.map(withEffects)');
  });
});

describe('the native renderers', () => {
  it('applies them on Android, and refuses what it cannot do', async () => {
    const kotlin = await read(
      'modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    // Opacity is a multiply, not an alpha: `AlphaScale` sets a channel the
    // encoder discards when there is a single sequence with nothing to
    // composite against, so the picture came out at full strength. Compositing
    // over black at alpha `a` is multiplying RGB by `a`.
    expect(kotlin).toContain('RgbAdjustment.Builder()');
    // A word boundary, not a substring: `StaticOverlaySettings.setAlphaScale`
    // is a different thing entirely — it is how a transition's dip and a title
    // are faded — and matching it here would fail for the wrong reason.
    expect(kotlin).not.toMatch(/\bAlphaScale\(/);
    // Scale is a crop, not a scale: `setScale` resizes the frame and the
    // `Presentation` fixing the output size fits it straight back, so the
    // picture came out exactly as it went in.
    expect(kotlin).toContain('Crop(-half, half, -half, half)');
    expect(kotlin).not.toMatch(/setScale\(segment\.scale/);
    expect(kotlin).toContain('ScaleAndRotateTransformation');
    expect(kotlin).toContain('ChannelMixingAudioProcessor');
    // An offset it cannot honour is named rather than rendered centred.
    expect(kotlin).toContain('ERR_UNSUPPORTED_OFFSET');
    // A sequence that opens with silence has to say what kind: Media3 refuses a
    // leading gap outright, so every timeline whose first clip does not start
    // at zero failed to export at all.
    expect(kotlin).toContain('experimentalSetForceVideoTrack');
    expect(kotlin).toContain('experimentalSetForceAudioTrack');
  });

  it('applies them on iOS', async () => {
    const swift = await read('modules/video-export/ios/VideoExportModule.swift');
    expect(swift).toContain('instruction.setOpacity(');
    expect(swift).toContain('CGAffineTransform(rotationAngle: radians)');
    // Scale about the clip's own centre, or enlarging it walks it off frame.
    expect(swift).toContain('translationX: -halfWidth');
    // An audio mix that is never handed to the session is no mix at all.
    expect(swift).toContain('session.audioMix = mix');
  });
});
