import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { MAX_BARS, MIN_WAVEFORM_WIDTH_PX, PX_PER_BAR, barCountFor, barHeights, peaksKey } from '../src/shared/audioPeaks';

const clip = { sourceStartMs: 0, sourceEndMs: 4_000 };

describe('how much of a sound to ask for', () => {
  it('asks for one bar per few points of width', () => {
    expect(barCountFor(clip, PX_PER_BAR * 10)).toBe(10);
  });

  it('draws nothing on a clip too narrow to read', () => {
    expect(barCountFor(clip, MIN_WAVEFORM_WIDTH_PX - 1)).toBe(0);
    expect(barCountFor({ sourceStartMs: 0, sourceEndMs: 0 }, 500)).toBe(0);
  });

  it('stops before a long clip costs more than the picture is worth', () => {
    expect(barCountFor(clip, PX_PER_BAR * 5_000)).toBe(MAX_BARS);
  });
});

describe('the key a reading is remembered under', () => {
  it('changes when the clip is trimmed to a different part of the file', () => {
    expect(peaksKey('a', clip, 50)).not.toBe(peaksKey('a', { sourceStartMs: 1_000, sourceEndMs: 4_000 }, 50));
  });

  it('survives a nudge of a frame', () => {
    expect(peaksKey('a', clip, 50)).toBe(peaksKey('a', { sourceStartMs: 40, sourceEndMs: 3_960 }, 50));
  });
});

describe('turning peaks into bars', () => {
  it('normalises against the loudest bar, so a quiet clip is still legible', () => {
    // Against full scale this would draw as a flat line and say "no sound here"
    // about a clip that has plenty.
    expect(barHeights([0.02, 0.04, 0.01])).toEqual([0.5, 1, 0.25]);
  });

  it('keeps silence as a hairline rather than a gap', () => {
    // A clip that drew nothing at all would look like one that failed to load.
    expect(barHeights([0, 0, 0])).toEqual([0.02, 0.02, 0.02]);
    expect(barHeights([1, 0])[1]).toBe(0.02);
  });

  it('ignores a reading that is not a number', () => {
    expect(barHeights([Number.NaN, 1])).toEqual([0.02, 1]);
  });
});

/**
 * Who reads the sound, and who draws it.
 *
 * Source assertions for the native readers — except that the iOS one is run for
 * real by `ios-export`, which writes a clip that is silent then a tone and
 * checks the reading follows it.
 */
describe('the surfaces', () => {
  const readMobile = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('reads peaks natively on Android', async () => {
    const kotlin = await readMobile(
      'modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    // Decoded rather than estimated: nothing in a file's metadata says where it
    // is loud.
    expect(kotlin).toContain('readAudioPeaks');
    expect(kotlin).toContain('MediaCodec.createDecoderByType');
  });

  it('reads them on iOS with something a macOS test can run', async () => {
    const swift = await readMobile('modules/video-export/ios/AudioPeaks.swift');
    expect(swift).toContain('AVAssetReaderTrackOutput');
    // No ExpoModulesCore, which is what lets the composer tests exercise it.
    expect(swift).not.toContain('import ExpoModulesCore');
  });

  it('draws the sound of video clips, not only of audio ones', async () => {
    // The phone cannot import an audio file at all, so almost every sound in a
    // cut is a video clip's own.
    const clip = await readMobile('src/components/TimelineClip.tsx');
    expect(clip).toContain('useAudioPeaks');
    expect(clip).toContain('waveformStrip');
  });

  it('treats a file it cannot read as a clip drawn the way it was', async () => {
    const bridge = await readMobile('modules/video-export/index.ts');
    expect(bridge).toMatch(/readAudioPeaks[\s\S]{0,400}return \[\]/);
  });
});
