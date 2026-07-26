import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalTtsJobStore } from '../src/main/localTtsJobStore';
import type { LocalTtsRunnerConfig } from '../src/main/localTtsConfig';
import { VoiceTtsIpcService } from '../src/main/voiceTtsIpcService';
import { VoiceProfileStore } from '../src/main/voiceProfileStore';
import type { LocalQwenRunInput, LocalQwenRunResult } from '../src/main/localQwenRunner';

const CONFIG: LocalTtsRunnerConfig = {
  executablePath: '/opt/qwen/bin/qwen-tts',
  modelPath: '/opt/qwen/model',
  argsTemplate: ['{modelPath}', '{voiceSamplePath}', '{textPath}', '{outputPath}'],
  outputExtension: '.wav',
  outputMimeType: 'audio/wav',
  timeoutMs: 120_000,
  modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
};

function arrayBufferFromBytes(bytes: readonly number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe('voice and local TTS IPC service', () => {
  it('validates voice profile lifecycle payloads and never returns profile filesystem paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-tts-ipc-'));
    const service = new VoiceTtsIpcService({
      voiceProfiles: new VoiceProfileStore(join(root, 'voice-profiles')),
      ttsJobs: new LocalTtsJobStore()
    });

    const started = await service.startVoiceProfile({
      displayName: 'Narration profile',
      explicitConsent: true,
      consentTextVersion: '2026-07',
      language: 'en-US',
      narrationScript: 'Please read this sentence aloud.',
      mimeType: 'audio/wav'
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error('Expected voice profile sample start to succeed.');
    }
    expect(JSON.stringify(started.value)).not.toContain(root);

    await expect(service.appendVoiceProfile({ sampleId: started.value.sampleId, sequence: 0, chunk: arrayBufferFromBytes([1, 2]) })).resolves.toEqual({
      ok: true,
      value: { sequence: 0, totalBytes: 2 }
    });
    await expect(service.finalizeVoiceProfile({ sampleId: started.value.sampleId, durationMs: 9_999 })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'The voice profile finalize payload was not valid.' }
    });
    await expect(service.finalizeVoiceProfile({ sampleId: started.value.sampleId, durationMs: 12_000 })).resolves.toMatchObject({
      ok: true,
      value: { totalDurationMs: 12_000 }
    });

    const listed = await service.listVoiceProfiles();
    expect(listed).toMatchObject({ ok: true, value: [{ totalDurationMs: 12_000 }] });
    expect(JSON.stringify(listed)).not.toContain(root);
  });

  it('rejects a non-local domain model before reserving or creating a narration job', async () => {
    const service = new VoiceTtsIpcService({
      voiceProfiles: new VoiceProfileStore(join(tmpdir(), 'voice-tts-invalid-model')),
      ttsJobs: new LocalTtsJobStore()
    });

    await expect(service.startTtsJob({
      voiceProfileId: 'profile_01',
      script: 'Hello',
      language: 'en-US',
      mimeType: 'audio/wav',
      modelId: 'elevenlabs-multilingual-v2'
    })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Model elevenlabs-multilingual-v2 is not available for local Qwen TTS.' }
    });
  });

  it('loads local TTS config, derives the profile sample path in main, completes asynchronously, and opens only known results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-tts-ipc-'));
    const audioRoot = join(root, 'tts-audio');
    const backgroundTasks: Promise<void>[] = [];
    const openedPaths: string[] = [];
    const revealedPaths: string[] = [];
    const runnerInputs: LocalQwenRunInput[] = [];
    const service = new VoiceTtsIpcService({
      voiceProfiles: new VoiceProfileStore(join(root, 'voice-profiles')),
      ttsJobs: new LocalTtsJobStore({ createId: () => 'job_01' }),
      audioRoot,
      loadConfig: async () => ({ kind: 'configured', config: CONFIG }),
      createRunner: () => ({
        async run(input): Promise<LocalQwenRunResult> {
          runnerInputs.push(input);
          const outputPath = join(audioRoot, 'asset_01.wav');
          await mkdir(audioRoot, { recursive: true });
          await writeFile(outputPath, 'audio');
          return {
            assetId: 'asset_01',
            outputPath,
            modelId: CONFIG.modelId,
            mimeType: CONFIG.outputMimeType,
            byteLength: 5
          };
        }
      }),
      runInBackground: (task) => {
        backgroundTasks.push(task());
      },
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      },
      revealPath: (path) => {
        revealedPaths.push(path);
      }
    });

    const startedProfile = await service.startVoiceProfile({
      displayName: 'Narration profile',
      explicitConsent: true,
      consentTextVersion: '2026-07',
      language: 'en-US',
      narrationScript: 'Please read this sentence aloud.',
      mimeType: 'audio/wav'
    });
    if (!startedProfile.ok) {
      throw new Error('Expected profile start to succeed.');
    }
    await service.appendVoiceProfile({ sampleId: startedProfile.value.sampleId, sequence: 0, chunk: arrayBufferFromBytes([1]) });
    const profile = await service.finalizeVoiceProfile({ sampleId: startedProfile.value.sampleId, durationMs: 12_000 });
    if (!profile.ok) {
      throw new Error('Expected profile finalize to succeed.');
    }

    const missingProfileJob = await service.startTtsJob({
      voiceProfileId: 'missing_profile',
      script: 'Hello',
      language: 'en-US',
      mimeType: 'audio/wav'
    });
    expect(missingProfileJob).toMatchObject({ ok: false, error: { code: 'PROFILE_NOT_FOUND' } });

    const startedJob = await service.startTtsJob({
      voiceProfileId: profile.value.id,
      script: 'Hello from OpenVideo.',
      language: 'en-US',
      mimeType: 'audio/wav',
      modelId: 'local-qwen-tts'
    });
    expect(startedJob).toMatchObject({ ok: true, value: { id: 'job_01', modelId: 'local-qwen-tts', state: { kind: 'queued' } } });
    expect(JSON.stringify(startedJob)).not.toContain(root);

    await Promise.all(backgroundTasks);

    const completedJob = await service.getTtsJob({ jobId: 'job_01' });
    expect(completedJob).toMatchObject({ ok: true, value: { state: { kind: 'completed', outputAssetId: 'asset_01' } } });
    expect(runnerInputs).toHaveLength(1);
    expect(runnerInputs[0]?.voiceSamplePath.startsWith(join(root, 'voice-profiles'))).toBe(true);
    expect(JSON.stringify(completedJob)).not.toContain(audioRoot);

    await expect(service.openTtsResult({ jobId: 'job_01' })).resolves.toEqual({ ok: true, value: { opened: true } });
    await expect(service.revealTtsResult({ jobId: 'job_01' })).resolves.toEqual({ ok: true, value: { revealed: true } });
    expect(openedPaths).toEqual([join(audioRoot, 'asset_01.wav')]);
    expect(revealedPaths).toEqual([join(audioRoot, 'asset_01.wav')]);
  });

  it('reserves local TTS before async setup so overlapping starts cannot queue a second job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-tts-ipc-'));
    const voiceProfiles = new VoiceProfileStore(join(root, 'voice-profiles'));
    const begun = await voiceProfiles.begin({
      displayName: 'Narration profile',
      explicitConsent: true,
      consentTextVersion: '2026-07',
      language: 'en-US',
      narrationScript: 'Please read this sentence aloud.',
      mimeType: 'audio/wav'
    });
    await voiceProfiles.append(begun.sampleId, 0, arrayBufferFromBytes([1]));
    const profile = await voiceProfiles.finalize(begun.sampleId, 12_000);
    const backgroundTasks: Array<() => Promise<void>> = [];
    let releaseConfig: (() => void) | undefined;
    let configLoads = 0;
    let jobNumber = 0;
    const configGate = new Promise<void>((resolveGate) => {
      releaseConfig = resolveGate;
    });
    const service = new VoiceTtsIpcService({
      voiceProfiles,
      ttsJobs: new LocalTtsJobStore({
        createId: () => {
          jobNumber += 1;
          return `job_0${jobNumber}`;
        }
      }),
      loadConfig: async () => {
        configLoads += 1;
        await configGate;
        return { kind: 'configured', config: CONFIG };
      },
      createRunner: () => ({
        async run(): Promise<LocalQwenRunResult> {
          return {
            assetId: 'asset_serial',
            outputPath: join(root, 'tts-audio', 'asset_serial.wav'),
            modelId: CONFIG.modelId,
            mimeType: CONFIG.outputMimeType,
            byteLength: 5
          };
        }
      }),
      runInBackground: (task) => {
        backgroundTasks.push(task);
      }
    });
    const request = {
      voiceProfileId: profile.profile.id,
      script: 'Hello from OpenVideo.',
      language: 'en-US',
      mimeType: 'audio/wav'
    } as const;

    const firstStart = service.startTtsJob(request);
    const secondStart = service.startTtsJob(request);
    if (releaseConfig === undefined) {
      throw new Error('Expected local TTS config gate to be active.');
    }
    releaseConfig();

    await expect(firstStart).resolves.toMatchObject({ ok: true, value: { id: 'job_01' } });
    await expect(secondStart).resolves.toEqual({
      ok: false,
      error: { code: 'TTS_UNAVAILABLE', message: 'Local TTS is already processing a job.' }
    });
    expect(configLoads).toBe(1);
    expect(backgroundTasks).toHaveLength(1);

    const firstBackgroundTask = backgroundTasks[0];
    if (firstBackgroundTask === undefined) {
      throw new Error('Expected the first local TTS background task.');
    }
    await firstBackgroundTask();

    await expect(service.startTtsJob(request)).resolves.toMatchObject({ ok: true, value: { id: 'job_02' } });
    expect(configLoads).toBe(2);
    expect(backgroundTasks).toHaveLength(2);
  });
});
