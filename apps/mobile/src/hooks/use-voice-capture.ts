/**
 * Microphone capture for the live damage walkaround.
 *
 * This hook records and hands back the local file; it does not transcribe. Transcription
 * belongs to the backend (`POST /v1/audio/transcribe`), which stores the clip, runs ASR and
 * turns the transcript into evidence on the case — so the audio must be uploaded rather
 * than converted on device. `useCase().transcribe` is the other half.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export type VoiceCaptureStatus = 'idle' | 'recording' | 'unavailable';

/** A finished recording, ready to upload. */
export interface Recording {
  uri: string;
  mimeType: string;
}

export interface UseVoiceCaptureResult {
  status: VoiceCaptureStatus;
  isRecording: boolean;
  /** Milliseconds recorded so far, for a timer display. */
  durationMs: number;
  /** Metering level 0..1 if available, for a level meter. */
  level: number;
  error: string | null;
  start: () => Promise<void>;
  /** Stops recording and resolves with the clip to upload, or null if there is none. */
  stop: () => Promise<Recording | null>;
}

export function useVoiceCapture(): UseVoiceCaptureResult {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [status, setStatus] = useState<VoiceCaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (cancelled) return;

        if (!permission.granted) {
          setStatus('unavailable');
          setError('Microphone permission was denied. You can still type damage below.');
          return;
        }

        // Required on iOS for recording to actually produce audio.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      } catch (err) {
        if (cancelled) return;
        setStatus('unavailable');
        setError(err instanceof Error ? err.message : 'Microphone unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (status === 'unavailable') return;
    setError(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
      setStatus('idle');
    }
  }, [recorder, status]);

  const stop = useCallback(async (): Promise<Recording | null> => {
    if (status !== 'recording') return null;
    try {
      await recorder.stop();
      setStatus('idle');

      const uri = recorder.uri;
      if (!uri) {
        setError('The recording produced no audio.');
        return null;
      }
      return { uri, mimeType: 'audio/m4a' };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop recording');
      setStatus('idle');
      return null;
    }
  }, [recorder, status]);

  return {
    status,
    isRecording: recorderState.isRecording,
    durationMs: recorderState.durationMillis ?? 0,
    // Metering is reported in dB (-160..0); normalise for a simple level meter.
    level: recorderState.metering == null ? 0 : Math.max(0, Math.min(1, (recorderState.metering + 60) / 60)),
    error,
    start,
    stop,
  };
}
