import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AllowedAudioMimeType, LocalTtsJob, LocalTtsRuntimeStatus, VoiceProfile, VoiceProfileSampleSession } from '../../shared/models';
import { errorMessage, type StatusMessage } from './appTypes';
import {
  CONSENT_TEXT_VERSION,
  DEFAULT_NARRATION_SCRIPT,
  assessNarrationProfileDraft,
  canStartTtsJob,
  chooseAudioRecorderMimeType,
  isCompletedTtsJob,
  isNarrationSampleDurationValid,
  publicRuntimeStatusText,
  ttsJobStatusText
} from './narrationLogic';
import { stopMediaStream } from './recorder';

type SampleState = 'idle' | 'recording' | 'recorded' | 'saving';

export function useNarration() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<LocalTtsRuntimeStatus | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [narrationScript, setNarrationScript] = useState(DEFAULT_NARRATION_SCRIPT);
  const [explicitConsent, setExplicitConsent] = useState(false);
  const [sampleState, setSampleState] = useState<SampleState>('idle');
  const [sampleDurationMs, setSampleDurationMs] = useState(0);
  const [ttsScript, setTtsScript] = useState('');
  const [ttsMimeType, setTtsMimeType] = useState<AllowedAudioMimeType>('audio/wav');
  const [ttsJob, setTtsJob] = useState<LocalTtsJob | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({ tone: 'neutral', text: 'Create or select a local voice profile for narration.' });

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sampleSessionRef = useRef<VoiceProfileSampleSession | null>(null);
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sequenceRef = useRef(0);
  const durationTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRequestedRef = useRef(false);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);
  const assessedDraft = assessNarrationProfileDraft({ displayName, explicitConsent, language, narrationScript });
  const canSaveSample = sampleState === 'recorded' && isNarrationSampleDurationValid(sampleDurationMs);
  const canGenerateTts = canStartTtsJob({ runtimeStatus, selectedProfile, script: ttsScript });

  const stopSampleTimer = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const refreshProfiles = useCallback(async () => {
    const response = await window.videoTool.listVoiceProfiles();
    if (response.ok) {
      setProfiles(response.value);
      setSelectedProfileId((current) => current.length > 0 ? current : response.value[0]?.id ?? '');
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, []);

  const refreshRuntime = useCallback(async () => {
    const response = await window.videoTool.getTtsRuntimeStatus();
    if (response.ok) {
      setRuntimeStatus(response.value);
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, []);

  useEffect(() => {
    void refreshProfiles();
    void refreshRuntime();
    return () => {
      stopSampleTimer();
      stopMediaStream(streamRef.current);
      const session = sampleSessionRef.current;
      if (session !== null) {
        void window.videoTool.discardVoiceProfile({ sampleId: session.sampleId });
      }
    };
  }, [refreshProfiles, refreshRuntime, stopSampleTimer]);

  const startSampleRecording = useCallback(async () => {
    if (!assessedDraft.canStart) {
      setStatusMessage({ tone: 'warning', text: 'Consent, display name, language, and sample script are required before microphone access.' });
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setStatusMessage({ tone: 'danger', text: 'MediaRecorder is unavailable in this renderer.' });
      return;
    }
    const mimeType = chooseAudioRecorderMimeType();
    const startResponse = await window.videoTool.startVoiceProfile({
      displayName: assessedDraft.displayName,
      explicitConsent: true,
      consentTextVersion: CONSENT_TEXT_VERSION,
      language: assessedDraft.language,
      narrationScript: assessedDraft.narrationScript,
      mimeType
    });
    if (!startResponse.ok) {
      setStatusMessage({ tone: 'danger', text: errorMessage(startResponse.error) });
      return;
    }
    sampleSessionRef.current = startResponse.value;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      appendQueueRef.current = Promise.resolve();
      sequenceRef.current = 0;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0 || sampleSessionRef.current === null) return;
        const sequence = sequenceRef.current;
        const sampleId = sampleSessionRef.current.sampleId;
        sequenceRef.current += 1;
        appendQueueRef.current = appendQueueRef.current.then(async () => {
          const chunk = await event.data.arrayBuffer();
          const response = await window.videoTool.appendVoiceProfile({ sampleId, sequence, chunk });
          if (!response.ok) throw new Error(errorMessage(response.error));
        });
      });
      recorder.addEventListener('stop', () => {
        stopSampleTimer();
        stopMediaStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        if (discardRequestedRef.current) {
          discardRequestedRef.current = false;
          return;
        }
        setSampleState('recorded');
      });
      recordingStartedAtRef.current = performance.now();
      setSampleDurationMs(0);
      durationTimerRef.current = window.setInterval(() => {
        const startedAt = recordingStartedAtRef.current;
        if (startedAt !== null) setSampleDurationMs(performance.now() - startedAt);
      }, 100);
      recorder.start(1000);
      setSampleState('recording');
      setStatusMessage({ tone: 'neutral', text: 'Recording microphone sample locally. Stop between 10 and 30 seconds.' });
    } catch (error: unknown) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      await window.videoTool.discardVoiceProfile({ sampleId: startResponse.value.sampleId });
      sampleSessionRef.current = null;
      setSampleState('idle');
      setStatusMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Microphone access failed.' });
    }
  }, [assessedDraft, stopSampleTimer]);

  const stopSampleRecording = useCallback(() => {
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      setStatusMessage({ tone: 'neutral', text: 'Microphone sample stopped. Save it if the duration is valid.' });
    }
  }, []);

  const saveSample = useCallback(async () => {
    const session = sampleSessionRef.current;
    if (session === null || !canSaveSample) return;
    setSampleState('saving');
    try {
      await appendQueueRef.current;
    } catch (error: unknown) {
      setSampleState('recorded');
      setStatusMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Voice sample chunks could not be saved.' });
      return;
    }
    const response = await window.videoTool.finalizeVoiceProfile({ sampleId: session.sampleId, durationMs: Math.round(sampleDurationMs) });
    if (response.ok) {
      sampleSessionRef.current = null;
      setProfiles((current) => [response.value, ...current]);
      setSelectedProfileId(response.value.id);
      setSampleState('idle');
      setStatusMessage({ tone: 'success', text: 'Voice profile saved locally.' });
      return;
    }
    setSampleState('recorded');
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [canSaveSample, sampleDurationMs]);

  const discardSample = useCallback(async () => {
    const session = sampleSessionRef.current;
    discardRequestedRef.current = true;
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    stopSampleTimer();
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (session !== null) await window.videoTool.discardVoiceProfile({ sampleId: session.sampleId });
    sampleSessionRef.current = null;
    setSampleState('idle');
    setSampleDurationMs(0);
    setStatusMessage({ tone: 'warning', text: 'Voice sample discarded.' });
  }, [stopSampleTimer]);

  const deleteSelectedProfile = useCallback(async () => {
    if (selectedProfile === null) return;
    const response = await window.videoTool.deleteVoiceProfile({ voiceProfileId: selectedProfile.id });
    if (response.ok) {
      setProfiles((current) => current.filter((profile) => profile.id !== selectedProfile.id));
      setSelectedProfileId('');
      setStatusMessage({ tone: 'warning', text: 'Selected voice profile deleted locally.' });
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [selectedProfile]);

  const startTtsJob = useCallback(async (modelId: string) => {
    if (selectedProfile === null || runtimeStatus?.kind !== 'ready') return;
    const response = await window.videoTool.startTtsJob({ voiceProfileId: selectedProfile.id, script: ttsScript.trim(), language: selectedProfile.language, mimeType: ttsMimeType, modelId });
    if (response.ok) {
      setTtsJob(response.value);
      setStatusMessage({ tone: 'neutral', text: 'Local Qwen narration job started.' });
      return;
    }
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [runtimeStatus, selectedProfile, ttsMimeType, ttsScript]);

  useEffect(() => {
    if (ttsJob === null || ttsJob.state.kind === 'completed' || ttsJob.state.kind === 'failed') return;
    const poller = window.setInterval(() => {
      void window.videoTool.getTtsJob({ jobId: ttsJob.id }).then((response) => {
        if (response.ok) setTtsJob(response.value);
      });
    }, 1500);
    return () => window.clearInterval(poller);
  }, [ttsJob]);

  return { profiles, selectedProfileId, setSelectedProfileId, selectedProfile, runtimeStatus, runtimeText: publicRuntimeStatusText(runtimeStatus), displayName, setDisplayName, language, setLanguage, narrationScript, setNarrationScript, explicitConsent, setExplicitConsent, sampleState, sampleDurationMs, canStartSample: assessedDraft.canStart && sampleState === 'idle', canSaveSample, ttsScript, setTtsScript, ttsMimeType, setTtsMimeType, ttsJob, ttsJobText: ttsJobStatusText(ttsJob), canGenerateTts, isTtsComplete: isCompletedTtsJob(ttsJob), statusMessage, refreshProfiles, refreshRuntime, startSampleRecording, stopSampleRecording, saveSample, discardSample, deleteSelectedProfile, startTtsJob };
}
