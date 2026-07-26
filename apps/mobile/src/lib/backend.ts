/**
 * Client for the FastAPI prediction backend (`backend/`, port 8080).
 *
 * This is the API the spec describes: regos resolve to a VIN and a catalogue, evidence
 * accumulates on a case, and the whole prediction is recomputed from scratch on every
 * event. It supersedes the Express jobs API for the assessment flow.
 *
 * Live status is polled rather than streamed. The backend does expose SSE at
 * `/case/{id}/stream`, but React Native ships no `EventSource` and `fetch` cannot be read
 * incrementally, so consuming it needs a polyfill (`react-native-sse`) or an XHR
 * progress-event reader. Vehicle resolution takes 800–5000 ms, so polling `GET /case/{id}`
 * is indistinguishable to the repairer and has no new dependency. Swap `pollCase` for a
 * stream reader when the polyfill lands — nothing else needs to change.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  AllowedVehicle,
  Attribution,
  CaseDetail,
  CaseMessage,
  DamageReport,
  Offer,
  Question,
  ReportLine,
  SendToCustomerResponse,
  Vehicle,
  VehicleSummary,
} from '@partli/shared';

const PORT = 8080;

function resolveBaseUrl(): { url: string; unreachableReason?: string } {
  // Either spelling works; both appear in the setup notes.
  const configured = process.env.EXPO_PUBLIC_API_URL ?? process.env.EXPO_PUBLIC_BACKEND_URL;
  if (configured) return { url: configured.replace(/\/$/, '') };

  // A phone cannot reach `localhost`, so reuse the LAN IP Metro is served from — that is
  // the machine running the backend.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (!host) {
    // No host to borrow. In a browser the page's own origin is the dev machine,
    // so `localhost` is right there and wrong on a device — say which case this
    // is rather than letting a phone fail with an address that means itself.
    const origin =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : null;
    if (origin && origin !== 'localhost' && origin !== '127.0.0.1') {
      return { url: `http://${origin}:${PORT}` };
    }
    return {
      url: `http://localhost:${PORT}`,
      unreachableReason:
        `Could not work out this machine's address, so it fell back to localhost. ` +
        `That is the phone itself on a device — set EXPO_PUBLIC_API_URL in ` +
        `apps/mobile/.env to your computer's LAN IP (e.g. http://192.168.1.20:${PORT}) ` +
        `and restart Expo.`,
    };
  }

  // `localhost` means the device itself. In a browser on the dev machine that
  // is the right answer; on a phone it is a dead end, and the failure needs to
  // say so rather than suggest checking the wifi.
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  if (isLoopback && Platform.OS !== 'web') {
    return {
      url: `http://${host}:${PORT}`,
      unreachableReason:
        `Metro reported ${host}, which on a phone means the phone. Set ` +
        `EXPO_PUBLIC_API_URL in apps/mobile/.env to this computer's LAN IP ` +
        `(e.g. http://192.168.1.20:${PORT}) and restart Expo.`,
    };
  }

  const isLanAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || isLoopback;
  if (!isLanAddress) {
    return {
      url: `http://${host}:${PORT}`,
      unreachableReason:
        `Metro is served through a tunnel (${host}), which does not forward the backend. ` +
        `Set EXPO_PUBLIC_BACKEND_URL in apps/mobile/.env to a reachable URL, then restart Expo.`,
    };
  }
  return { url: `http://${host}:${PORT}` };
}

const resolved = resolveBaseUrl();
export const BACKEND_BASE_URL = `${resolved.url}/v1`;

// --- Wire types -------------------------------------------------------------
//
// The single source of truth is @partli/shared, which mirrors the /v1 contract.
// Re-exported here under the names this client's screens already use, so a
// contract change is a compile error rather than a runtime surprise. (This file
// used to carry its own copies; that drift is exactly what broke rego.ts in the
// merge.)


export type VehiclePayload = Vehicle;
export type VehicleListItem = VehicleSummary;
export type { AllowedVehicle };
export type ClarifyingQuestion = Question;
export type CaseReport = DamageReport;
export type { Attribution, CaseDetail, CaseMessage, Offer, ReportLine };

export class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new BackendError(
      0,
      'Cannot reach the prediction backend',
      resolved.unreachableReason ??
        `Tried ${BACKEND_BASE_URL}. Is uvicorn running on ${PORT}, and is your phone on the ` +
          `same network? (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // One envelope everywhere: { error: { code, message, retryable } }.
    const envelope = body?.error;
    throw new BackendError(
      response.status,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.code,
    );
  }

  return body as T;
}

/**
 * POST a multipart body.
 *
 * Kept out of `request` because that sets a JSON content-type, and fetch must be left to
 * write its own `boundary` header — setting it by hand produces a body the server cannot
 * parse.
 */
async function postForm<T>(path: string, form: FormData, failureTitle: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_BASE_URL}${path}`, { method: 'POST', body: form });
  } catch (error) {
    throw new BackendError(
      0,
      failureTitle,
      resolved.unreachableReason ??
        `Tried ${BACKEND_BASE_URL}. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new BackendError(
      response.status,
      body?.error?.message ?? `${failureTitle} (${response.status})`,
      body?.error?.code,
    );
  }
  return body as T;
}

export const backend = {
  listVehicles: () => request<{ vehicles: VehicleListItem[] }>('/vehicles'),

  /**
   * The regos a case may actually be opened against — the three that ship a
   * full OEM catalogue. `/vehicles` lists everything the plate reader knows,
   * most of which has nothing to predict over, so the entry screen offers
   * these instead.
   */
  allowedVehicles: () =>
    request<{ vehicles: AllowedVehicle[] }>('/vehicles/allowed'),

  /** Returns immediately; the vehicle resolves in the background. */
  registerVehicle: (rego: string) =>
    request<VehiclePayload>('/vehicle/register', {
      method: 'POST',
      body: JSON.stringify({ rego }),
    }),

  getVehicle: (vehicleId: string) => request<VehiclePayload>(`/vehicle/${vehicleId}`),

  createCase: (vehicleId: string) =>
    request<{ case_id: string }>('/case', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId }),
    }),

  /** The case with its message history. Note: `CaseDetail`, not a report. */
  getCase: (caseId: string) => request<CaseDetail>(`/case/${caseId}`),

  /**
   * Upload photos or a walkaround video. Accepted (202); the backend stores each asset,
   * pulls keyframes from video and runs vision over them, then folds the result into the
   * case as evidence — so the caller re-reads the report afterwards.
   *
   * Video keyframe extraction needs `ffmpeg` on the backend host. Without it the clip is
   * stored and accepted but yields no frames to analyse.
   */
  uploadMedia: async (
    caseId: string,
    kind: 'image' | 'video',
    files: { uri: string; name: string; type: string }[],
  ): Promise<{ media_ids: string[]; status: string }> => {
    const form = new FormData();
    form.append('case_id', caseId);
    form.append('kind', kind);
    // `files` is a list on the server, so the field repeats.
    for (const file of files) form.append('files', file as unknown as Blob);
    return postForm('/media/upload', form, 'Could not upload the media');
  },

  /**
   * Upload a voice clip. Accepted (202) and transcribed in the background, so the caller
   * polls `getCase` for the message's `transcript` to fill in.
   *
   * Multipart, so it cannot go through `request` — that sets a JSON content-type, and
   * fetch must be left to write its own boundary header.
   */
  transcribeAudio: (
    caseId: string,
    uri: string,
    mimeType = 'audio/m4a',
  ): Promise<{ message_id: string; status: string }> => {
    const form = new FormData();
    form.append('case_id', caseId);
    // React Native accepts this shape where the web would need a Blob.
    form.append('file', { uri, name: 'clip.m4a', type: mimeType } as unknown as Blob);
    return postForm('/audio/transcribe', form, 'Could not upload the recording');
  },

  /** Accepted (202) — evidence is appended and the prediction recomputed. */
  sendMessage: (caseId: string, text: string) =>
    request<unknown>(`/case/${caseId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  answerQuestion: (caseId: string, questionId: string, value: string) =>
    request<CaseReport>(`/case/${caseId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ question_id: questionId, value }),
    }),

  /**
   * Kick off a re-score. Returns an acknowledgement, **not** the report — read it back
   * with `getResults`. Typing this as a report is what let a blank screen through once.
   */
  runPrediction: (caseId: string) =>
    request<{ prediction_id: string; computed_ms: number }>('/prediction/run', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId }),
    }),

  getResults: (caseId: string) => request<CaseReport>(`/prediction/results/${caseId}`),

  confirmInspection: (caseId: string, partId: string, damaged: boolean) =>
    request<CaseReport>('/inspection/confirm', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, part_id: partId, damaged }),
    }),

  /** Build the quote and mint the customer's approval link. */
  sendToCustomer: (caseId: string) =>
    request<SendToCustomerResponse>(`/case/${caseId}/send-to-customer`, {
      method: 'POST',
    }),

  getOffers: (partId: string) =>
    request<{ part_id: string; offers: Offer[]; simulated: boolean }>(`/parts/${partId}/offers`),
};

/**
 * The URL for one diagram's `image.webp` (spec 6.1) — served immutable, so the
 * exploded-diagram viewer can point straight at it and let the platform cache
 * it for good. Callers must check `diagram_available` on the report line
 * first: the catalogue references far more diagrams than ship with the
 * bundle, and this endpoint 404s for the rest.
 */
export function diagramImageUrl(slug: string, diagramId: string): string {
  return `${BACKEND_BASE_URL}/vehicles/${slug}/diagrams/${diagramId}/image`;
}

/**
 * Wait for a vehicle to stop resolving.
 *
 * `POST /vehicle/register` returns straight away with `status: "resolving"`, and
 * `POST /case` refuses an unresolved vehicle with 409 `vehicle_not_ready` — so anything
 * that needs a case has to wait for this first. Resolves with the settled vehicle whatever
 * the outcome (`catalogue_ready`, `no_catalogue`, `not_found`); the caller decides.
 */
export async function waitForVehicleReady(
  vehicleId: string,
  timeoutMs = 15_000,
  intervalMs = 400,
): Promise<VehiclePayload> {
  const deadline = Date.now() + timeoutMs;
  let vehicle = await backend.getVehicle(vehicleId);

  while (vehicle.status === 'resolving' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    vehicle = await backend.getVehicle(vehicleId);
  }

  return vehicle;
}

/**
 * Poll a vehicle until resolution settles, calling back on every change.
 *
 * Stands in for the SSE `vehicle` event (see the module note). Returns a cancel function.
 */
export function pollVehicle(
  vehicleId: string,
  onChange: (vehicle: VehiclePayload) => void,
  intervalMs = 700,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (cancelled) return;
    try {
      const vehicle = await backend.getVehicle(vehicleId);
      if (cancelled) return;
      onChange(vehicle);
      if (vehicle.status === 'resolving') timer = setTimeout(tick, intervalMs);
    } catch {
      // Transient failures are not worth surfacing mid-poll; the screen already has
      // whatever it last read, and the next user action reports properly.
      if (!cancelled) timer = setTimeout(tick, intervalMs * 2);
    }
  };

  void tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
