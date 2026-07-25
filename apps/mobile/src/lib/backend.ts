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

export interface VehiclePayload {
  vehicle_id: string;
  /** `resolving` | `catalogue_ready` | `no_catalogue` | `not_found` */
  status: string;
  rego: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  model_code: string | null;
  market: string | null;
  steering: string | null;
  parts_indexed: number | null;
  resolved_ms: number | null;
}

export interface VehicleListItem {
  slug: string;
  rego: string;
  make: string;
  model: string;
  year: number | null;
  has_prediction: boolean;
  has_catalogue: boolean;
}

/** One term of the noisy-OR decomposition — an exact share, not a heuristic. */
export interface Attribution {
  cause: string;
  relation: string;
  share: number;
}

export interface ReportLine {
  part_id: string;
  part_number: string | null;
  name: string;
  /** Probability this part is damaged, 0..1. */
  p: number;
  qty: number;
  diagram_id?: string;
  /** False when the diagram ships no image — do not render a hotspot over a 404. */
  diagram_available?: boolean;
  hotspot?: number[];
  /** Plain English, present on the order and check sections. */
  reason?: string;
  confirmed?: boolean | null;
  /** Counterfactual ordering: what to look at first. */
  inspection_rank?: number;
  inspection_value?: number;
  accessible?: boolean;
  attribution?: Attribution[];
}

export interface ClarifyingQuestion {
  id: string;
  text: string;
  options: string[];
  /** How much answering moves the report. The engine asks only when this is worth it. */
  value: number;
}

export interface CaseReport {
  case_id: string;
  status: string;
  vehicle: VehiclePayload;
  impact: { zone: string | null; side: string | null; severity: number | null };
  question: ClarifyingQuestion | null;
  sections: { visible: ReportLine[]; order: ReportLine[]; check: ReportLine[] };
  hidden_count?: number;
  computed_ms?: number;
  candidates?: number;
  /** True when the vehicle has no catalogue, so claims stay class-level. */
  degraded?: boolean;
}

export interface Offer {
  offer_id: string;
  supplier: string;
  kind: string;
  price_nzd: number;
  lead_days: number;
  in_stock: boolean;
  recommended: boolean;
  why?: string;
}

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
    // FastAPI puts validation problems in `detail`, which may be a string or a list.
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail);
    throw new BackendError(
      response.status,
      body?.error ?? body?.message ?? `Request failed (${response.status})`,
      detail,
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
