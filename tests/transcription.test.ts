import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyAiProjectDocument, parseAiProjectDocument, removeAssetFromAiProjectDocument } from '../src/shared/aiProjectDomain';
import { createInitialTimeline, INITIAL_AUDIO_TRACK_ID, placeClip } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import { applyTranscriptionCues, parseStartTranscriptionInput, parseTranscriptionDraft, updateTranscriptionDraft } from '../src/shared/transcription';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { parseWhisperSrt, resolveWhisperCppRuntime } from '../src/main/whisperCppAdapter';
import { applyCaptionPreset } from '../src/shared/captionStyle';

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function draft() {
  return {
    id: 'transcript-1', sourceAssetId: 'audio-1', engine: 'whisper.cpp' as const,
    modelName: 'ggml-small.bin', language: 'vi', createdAt: '2026-09-06T00:00:00.000Z', status: 'draft' as const,
    cues: [
      { id: 'transcript-cue-1', text: 'Xin chào.', startMs: 100, endMs: 1_100 },
      { id: 'transcript-cue-2', text: 'Đây là phụ đề.', startMs: 1_100, endMs: 2_500 }
    ]
  };
}

describe('local transcription contract', () => {
  it('validates path-free requests and reviewed transcript timing', () => {
    expect(parseStartTranscriptionInput({ projectId: 'project-1', assetId: 'audio-1', language: 'VI' })).toEqual({ projectId: 'project-1', assetId: 'audio-1', language: 'vi' });
    expect(parseStartTranscriptionInput({ projectId: 'project-1', assetId: 'audio-1', language: 'vi', sourcePath: 'C:/secret.wav' })).toBeNull();
    expect(parseTranscriptionDraft(draft())).toEqual(draft());
    expect(parseTranscriptionDraft({ ...draft(), cues: [draft().cues[0], { ...draft().cues[1], startMs: 1_000 }] })).toBeNull();
    expect(updateTranscriptionDraft(draft(), draft().cues, true).status).toBe('approved');
  });

  it('parses whisper.cpp SRT output and rejects malformed or overlapping segments', () => {
    const parsed = parseWhisperSrt('1\r\n00:00:00,120 --> 00:00:01,500\r\nXin chào.\r\n\r\n2\r\n00:00:01,500 --> 00:00:03,000\r\nDòng một.\r\nDòng hai.\r\n');
    expect(parsed).toEqual([
      { id: 'transcript-cue-1', text: 'Xin chào.', startMs: 120, endMs: 1_500 },
      { id: 'transcript-cue-2', text: 'Dòng một.\nDòng hai.', startMs: 1_500, endMs: 3_000 }
    ]);
    expect(() => parseWhisperSrt('1\n00:00:01,000 --> 00:00:00,900\nBad')).toThrow('malformed');
    expect(() => parseWhisperSrt('1\n00:00:00,000 --> 00:00:02,000\nA\n\n2\n00:00:01,900 --> 00:00:03,000\nB')).toThrow('overlaps');
  });

  it('replaces prior automatic captions only after approval and preserves manual titles', () => {
    const initial = createInitialTimeline();
    const placed = placeClip(initial, { trackId: INITIAL_AUDIO_TRACK_ID, clip: { id: 'source-clip', assetId: 'audio-1', timelineStartMs: 5_000, sourceStartMs: 100, sourceEndMs: 2_500, sourceDurationMs: 2_500, effects: { ...DEFAULT_CLIP_EFFECTS, speed: 2 }, keyframes: [] } });
    const timeline = { ...placed!, titles: [
      { id: 'manual-title', text: 'Manual', timelineStartMs: 0, timelineEndMs: 1_000, sizePx: 72, color: '#ffffff', positionX: 0, positionY: 0 },
      applyCaptionPreset({ id: 'auto-caption-old', text: 'Old', timelineStartMs: 0, timelineEndMs: 1_000, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 0 }, 'cinema')
    ] };
    expect(() => applyTranscriptionCues(timeline, draft())).toThrow('Approve');
    const applied = applyTranscriptionCues(timeline, updateTranscriptionDraft(draft(), draft().cues, true));
    expect(applied.titles?.some((title) => title.id === 'manual-title')).toBe(true);
    expect(applied.titles?.some((title) => title.id === 'auto-caption-old')).toBe(false);
    expect(applied.titles?.filter((title) => title.id.startsWith('transcript-caption-'))).toHaveLength(2);
    expect(applied.titles?.find((title) => title.id.startsWith('transcript-caption-'))).toMatchObject({ timelineStartMs: 5_000, timelineEndMs: 5_500 });
    expect(applied.titles?.find((title) => title.id.startsWith('transcript-caption-'))?.style).toMatchObject({ placement: 'bottom', fontWeight: 'regular' });
    expect(parseTimelineDocument(applied)).not.toBeNull();
  });

  it('persists only transcripts whose source asset exists and prunes them on removal', () => {
    const document = { ...createEmptyAiProjectDocument(), transcriptionDraft: draft() };
    expect(parseAiProjectDocument(document, new Set(['audio-1']))?.transcriptionDraft).toEqual(draft());
    expect(parseAiProjectDocument(document, new Set())).toBeNull();
    expect(removeAssetFromAiProjectDocument(document, 'audio-1').transcriptionDraft).toBeUndefined();
  });

  it('checks a user-managed executable and optional model checksum without exposing paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-whisper-runtime-test-'));
    temporaryDirectories.push(directory);
    const modelPath = join(directory, 'ggml-test.bin');
    const bytes = Buffer.from('test-model');
    await writeFile(modelPath, bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const result = await resolveWhisperCppRuntime({ environment: {
      OPENSCENE_WHISPER_CPP_PATH: process.execPath,
      OPENSCENE_WHISPER_MODEL_PATH: modelPath,
      OPENSCENE_WHISPER_MODEL_SHA256: checksum
    } });
    expect(result.status).toMatchObject({ ready: true, executableName: expect.any(String), modelName: 'ggml-test.bin', checksumVerified: true });
    expect(JSON.stringify(result.status)).not.toContain(directory);
  });

  it('auto-discovers the verified managed runtime when explicit paths are absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-managed-whisper-test-'));
    temporaryDirectories.push(directory);
    const runtimeRoot = join(directory, '.local-runtimes', 'whisper.cpp', 'b4938');
    const executablePath = join(runtimeRoot, 'bin', 'Release', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    const modelPath = join(runtimeRoot, 'models', 'ggml-small.bin');
    await mkdir(join(executablePath, '..'), { recursive: true });
    await mkdir(join(modelPath, '..'), { recursive: true });
    await copyFile(process.execPath, executablePath);
    const bytes = Buffer.from('managed-test-model');
    await writeFile(modelPath, bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const result = await resolveWhisperCppRuntime({
      workingDirectory: directory,
      environment: { OPENSCENE_WHISPER_MODEL_SHA256: checksum }
    });
    expect(result.status).toMatchObject({ ready: true, modelName: 'ggml-small.bin', checksumVerified: true });
  });
});
