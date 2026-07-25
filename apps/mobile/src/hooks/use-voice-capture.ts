/**
 * Microphone capture for the live damage walkaround.
 *
 * WHAT WORKS TODAY: permissions, recording, and producing a local audio file URI.
 * WHAT IS STUBBED: turning that audio into text. `transcribe()` is the single seam
 * to fill in — see the TODO below. Until it is implemented the capture screen's
 * text input is the way damage gets entered, and everything downstream (part
 * resolution, the oracle, the quote) already works off that text.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export type VoiceCaptureStatus = 'idle' | 'recording' | 'transcribing' | 'unavailable';

export interface UseVoiceCaptureResult {
  status: VoiceCaptureStatus;
  isRecording: boolean;
  /** Milliseconds recorded so far, for a timer display. */
  durationMs: number;
  /** Metering level 0..1 if available, for a level meter. */
  level: number;
  error: string | null;
  start: () => Promise<void>;
  /** Stops recording and resolves with transcribed text, or null if unavailable. */
  stop: () => Promise<string | null>;
}

/**
 * TODO(team): send the recorded audio to a speech-to-text service and return the
 * transcript. The file at `uri` is an m4a on device.
 *
 * Suggested approach: POST the file to a new `/api/transcribe` endpoint on apps/api
 * and call the provider from there, so the API key never ships inside the app
 * bundle. There is a placeholder for the key in apps/api/.env.example.
 */
async function transcribe(_uri: string): Promise<string | null> {
  return null;
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

  const stop = useCallback(async (): Promise<string | null> => {
    if (status !== 'recording') return null;
    try {
      await recorder.stop();
      setStatus('transcribing');

      const uri = recorder.uri;
      const text = uri ? await transcribe(uri) : null;

      setStatus('idle');
      if (text === null) {
        setError('Speech-to-text is not wired up yet — type the damage instead.');
      }
      return text;
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
