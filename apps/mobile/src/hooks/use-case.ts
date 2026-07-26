/**
 * All the state and actions for one case, in one place.
 *
 * Extracted from the diagnosis screen so the entry screen can hold a live case inline
 * without duplicating any of it. Both surfaces drive the same hook, so there is one
 * implementation of "confirm re-runs the prediction and the response is the new report".
 */

import { useCallback, useEffect, useState } from 'react';

import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { backend, pollVehicle, type CaseReport, type VehiclePayload } from '@/lib/backend';
import { labelCase } from '@/lib/recent-cases';

export interface ErrorInfo {
  title: string;
  detail?: string;
}

export interface UseCaseResult {
  report: CaseReport | null;
  loading: boolean;
  vehicle: VehiclePayload | null;
  error: ErrorInfo | null;
  /** part_id currently being confirmed. */
  busyId: string | null;
  /** The option currently being submitted, so the chip can show it. */
  answering: string | null;
  asking: boolean;
  /** True from upload until the transcript comes back. */
  transcribing: boolean;
  /** The last transcript the backend returned, so the UI can echo what it heard. */
  transcript: string | null;
  /** `damaged: null` clears a prior tick/cross, returning the part to the AI's own bucket. */
  confirm: (partId: string, damaged: boolean | null) => Promise<void>;
  answer: (questionId: string, value: string) => Promise<void>;
  ask: (text: string) => Promise<void>;
  transcribe: (uri: string, mimeType?: string) => Promise<void>;
  /** True while media is uploading and vision is running over it. */
  attaching: boolean;
  attach: (kind: 'image' | 'video', files: MediaFile[]) => Promise<void>;
  rerun: () => Promise<void>;
  /**
   * Same as `transcribe`/`attach` but against an explicit case id.
   *
   * The entry screen needs these: at the instant it creates a case, the `caseId` prop this
   * hook was called with is still null — React has not re-rendered yet — so the bound
   * versions would no-op and silently drop the capture.
   */
  transcribeInto: (caseId: string, uri: string, mimeType?: string) => Promise<void>;
  attachInto: (caseId: string, kind: 'image' | 'video', files: MediaFile[]) => Promise<void>;
}

export interface MediaFile {
  uri: string;
  name: string;
  type: string;
}

/** How long to wait for ASR before giving up on the transcript. */
const TRANSCRIBE_TIMEOUT_MS = 20_000;
const TRANSCRIBE_POLL_MS = 600;
/** Vision over keyframes is slower than ASR. */
const MEDIA_TIMEOUT_MS = 30_000;
const MEDIA_POLL_MS = 1_000;

/**
 * `caseId` may be null, which is the entry screen's state before anything is started.
 * Nothing is fetched until there is a case.
 */
export function useCase(caseId: string | null, vehicleId?: string | null): UseCaseResult {
  const report = useAsyncData(
    async () => (caseId ? backend.getResults(caseId) : null),
    [caseId],
  );

  /**
   * The polled vehicle, tagged with the case it belongs to. Tagging rather than clearing on
   * change means a new case shows no vehicle without a reset effect — the stale value is
   * simply not read.
   */
  const [tagged, setTagged] = useState<{ caseId: string; vehicle: VehiclePayload } | null>(null);
  const polled = tagged && tagged.caseId === caseId ? tagged.vehicle : null;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ErrorInfo | null>(null);

  /**
   * Track A: rego → VIN → catalogue, resolving in the background. Reloads the report once
   * when it settles, because the prediction only becomes part-level after the catalogue is
   * in.
   */
  useEffect(() => {
    if (!vehicleId || !caseId) return;
    let settled = false;
    const cancel = pollVehicle(vehicleId, (next) => {
      setTagged({ caseId, vehicle: next });
      if (!settled && next.status !== 'resolving') {
        settled = true;
        // The drawer row was created before the make/model was known.
        const name = [next.year, next.make, next.model].filter(Boolean).join(' ');
        if (name) labelCase(caseId, `${name} · ${next.rego}`);
        void report.reload();
      }
    });
    return cancel;
    // Keyed on the ids alone; `report` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, caseId]);

  const run = useCallback(
    async (work: () => Promise<CaseReport>, done?: () => void) => {
      setActionError(null);
      try {
        report.setData(await work());
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        done?.();
      }
    },
    [report],
  );

  const confirm = useCallback(
    async (partId: string, damaged: boolean | null) => {
      if (!caseId) return;
      setBusyId(partId);
      await run(
        () => backend.confirmInspection(caseId, partId, damaged),
        () => setBusyId(null),
      );
    },
    [caseId, run],
  );

  const answer = useCallback(
    async (questionId: string, value: string) => {
      if (!caseId) return;
      setAnswering(value);
      await run(
        () => backend.answerQuestion(caseId, questionId, value),
        () => setAnswering(null),
      );
    },
    [caseId, run],
  );

  /** A follow-up is more evidence: record it, then re-score against it. */
  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!caseId || !trimmed || asking) return;
      setAsking(true);
      await run(async () => {
        await backend.sendMessage(caseId, trimmed);
        // `runPrediction` only acknowledges; the report has to be read back.
        await backend.runPrediction(caseId);
        return backend.getResults(caseId);
      }, () => setAsking(false));
    },
    [caseId, asking, run],
  );

  /**
   * Upload a voice clip and wait for the transcript.
   *
   * The endpoint is 202 — it stores the clip, dispatches ASR and returns a message id, so
   * the transcript has to be polled for on `getCase`. Once it lands the backend has already
   * turned it into evidence, so the report is re-read rather than re-run.
   */
  const transcribeInto = useCallback(
    async (target: string, uri: string, mimeType?: string) => {
      setTranscribing(true);
      setActionError(null);
      setTranscript(null);
      try {
        const { message_id } = await backend.transcribeAudio(target, uri, mimeType);

        const deadline = Date.now() + TRANSCRIBE_TIMEOUT_MS;
        let text: string | null = null;
        while (Date.now() < deadline) {
          const detail = await backend.getCase(target);
          const message = detail.messages.find((m) => m.id === message_id);
          if (message?.transcript) {
            text = message.transcript;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_POLL_MS));
        }

        if (!text) {
          setActionError({
            title: 'Still transcribing',
            detail: 'The clip was uploaded but no transcript came back in time.',
          });
          return;
        }

        setTranscript(text);
        report.setData(await backend.getResults(target));
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setTranscribing(false);
      }
    },
    [report],
  );

  const transcribe = useCallback(
    async (uri: string, mimeType?: string) => {
      if (!caseId) return;
      await transcribeInto(caseId, uri, mimeType);
    },
    [caseId, transcribeInto],
  );

  /**
   * Upload photos or video and wait for vision to fold them into the case.
   *
   * 202 again, and unlike audio there is no per-message transcript to watch for — vision
   * produces observations, not text. So the report is re-read a few times and the screen
   * updates as the numbers move. Settles early once the computation changes.
   */
  const attachInto = useCallback(
    async (target: string, kind: 'image' | 'video', files: MediaFile[]) => {
      if (files.length === 0) return;
      setAttaching(true);
      setActionError(null);
      try {
        await backend.uploadMedia(target, kind, files);

        const before = report.data?.computed_ms;
        const deadline = Date.now() + MEDIA_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_MS));
          const next = await backend.getResults(target);
          report.setData(next);
          // The engine reports how long the run took, so a changed value means this upload
          // has been folded in. Without it there is nothing to distinguish a stale read.
          if (next.computed_ms !== before) break;
        }
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setAttaching(false);
      }
    },
    [report],
  );

  const attach = useCallback(
    async (kind: 'image' | 'video', files: MediaFile[]) => {
      if (!caseId) return;
      await attachInto(caseId, kind, files);
    },
    [caseId, attachInto],
  );

  const rerun = useCallback(async () => {
    if (!caseId) return;
    await run(async () => {
      await backend.runPrediction(caseId);
      return backend.getResults(caseId);
    });
  }, [caseId, run]);

  return {
    report: report.data ?? null,
    loading: report.loading,
    vehicle: polled ?? report.data?.vehicle ?? null,
    error: actionError ?? report.error ?? null,
    busyId,
    answering,
    asking,
    transcribing,
    transcript,
    confirm,
    answer,
    ask,
    transcribe,
    attaching,
    attach,
    rerun,
    transcribeInto,
    attachInto,
  };
}
