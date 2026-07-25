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
import type {
  Attribution,
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
  const configured = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (configured) return { url: configured.replace(/\/$/, '') };

  // A phone cannot reach `localhost`, so reuse the LAN IP Metro is served from — that is
  // the machine running the backend.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (!host) return { url: `http://localhost:${PORT}` };

  const isLanAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost';
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
export type ClarifyingQuestion = Question;
export type CaseReport = DamageReport;
export type { Attribution, Offer, ReportLine };

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

export const backend = {
  listVehicles: () => request<{ vehicles: VehicleListItem[] }>('/vehicles'),

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

  getCase: (caseId: string) => request<CaseReport>(`/case/${caseId}`),

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

  runPrediction: (caseId: string) =>
    request<CaseReport>('/prediction/run', {
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
