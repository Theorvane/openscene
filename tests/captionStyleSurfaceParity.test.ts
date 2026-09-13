import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Caption Studio surface parity', () => {
  it('passes the shared materialized style through previews and every final renderer', async () => {
    const [desktopPreview, ffmpeg, mobilePreview, mobileBridge, android, ios] = await Promise.all([
      source('src/renderer/src/editor/ProgramMonitor.tsx'),
      source('src/shared/ffmpegTimelineCompiler.ts'),
      source('mobile/src/components/PreviewPlayer.tsx'),
      source('mobile/src/lib/exportComposition.ts'),
      source('mobile/modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'),
      source('mobile/modules/video-export/ios/VideoComposer.swift')
    ]);
    expect(desktopPreview).toContain('resolvedTitleStyle(title)');
    expect(desktopPreview).toContain('WebkitTextStroke');
    expect(ffmpeg).toContain('titleOutputPosition(title, frame)');
    expect(ffmpeg).toContain('boxborderw=');
    expect(mobilePreview).toContain('resolvedTitleStyle(title)');
    expect(mobileBridge).toContain('backgroundOpacity: style.backgroundOpacity');
    expect(android).toContain('CaptionBackgroundSpan');
    expect(android).toContain('OutlineShadowSpan');
    expect(ios).toContain('kCTStrokeWidthAttributeName');
    expect(ios).toContain('title.backgroundOpacity');
  });

  it('exposes batch styling on both editors and keeps custom font upload out of the contract', async () => {
    const [desktop, mobile, shared] = await Promise.all([
      source('src/renderer/src/editor/InspectorPanel.tsx'),
      source('mobile/src/screens/EditScreen.tsx'),
      source('src/shared/captionStyle.ts')
    ]);
    expect(desktop).toContain('Apply appearance to');
    expect(mobile).toContain('Apply appearance to');
    expect(shared).toContain('applyTitleAppearanceToAutomaticCaptions');
    expect(shared).not.toContain('fontPath');
  });
});
