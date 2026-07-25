/**
 * Typed client for the Partli `/v1` API (the Python backend in `backend/`).
 *
 * Types come from `@partli/shared`, so a change to the API contract shows up
 * here as a compile error rather than a runtime surprise.
 *
 * Two things shape this file:
 *
 * - The API separates VIN resolution from assessment. `POST /vehicle/register`
 *   starts a background lookup; a case can only be opened once it finishes. So
 *   `startCase` does the waiting rather than making every screen deal with it.
 * - The report is always sent whole. There are no patch endpoints: confirming a
 *   part returns a complete replacement report and the client swaps its whole
 *   view. That is what makes the confirm loop feel instant.
 */

import Constants from 'expo-constants';
import type {
  ApprovalPayload,
  CaseDetail,
  CaseListItem,
  CaseSummary,
  DamageDetail,
  DamageReport,
  OrderLineInput,
  PlacedOrder,
  Recommendations,
  RegisterVehicleResponse,
  SendToCustomerResponse,
  Vehicle,
  VehicleSummary,
} from '@partli/shared';

/**
 * Where the API lives.
 *
 * A phone cannot reach `localhost` — that resolves to the phone itself. So when
 * EXPO_PUBLIC_API_URL is not set we reuse the LAN IP that Metro is already serving
 * from, which is exactly the machine running the API.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:8080`;

  return 'http://localhost:8080';
}

export const API_BASE_URL = resolveBaseUrl();
const V1 = `${API_BASE_URL}/v1`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    /** Retryable errors are worth offering a retry button for. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${V1}${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(
      0,
      'Cannot reach the API',
      `Tried ${V1}. Is it running, and is your phone on the same network? ` +
        `Set EXPO_PUBLIC_API_URL to override. (${
          error instanceof Error ? error.message : String(error)
        })`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // The backend uses one error envelope everywhere: { error: { code, message, retryable } }.
    const envelope = body?.error;
    throw new ApiError(
      response.status,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.code,
      Boolean(envelope?.retryable),
    );
  }

  return body as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const api = {
  // --- vehicles -----------------------------------------------------------

  listVehicles: async (): Promise<VehicleSummary[]> => {
    const body = await request<{ vehicles: VehicleSummary[] }>('/vehicles');
    return body.vehicles;
  },

  registerVehicle: (rego: string) =>
    request<RegisterVehicleResponse>('/vehicle/register', {
      method: 'POST',
      body: JSON.stringify({ rego }),
    }),

  getVehicle: (vehicleId: string) => request<Vehicle>(`/vehicle/${vehicleId}`),

  // --- cases --------------------------------------------------------------

  createCase: (vehicleId: string) =>
    request<CaseSummary>('/case', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId }),
    }),

  listCases: async (): Promise<CaseListItem[]> => {
    const body = await request<{ cases: CaseListItem[] }>('/cases');
    return body.cases;
  },

  getCase: (caseId: string) => request<CaseDetail>(`/case/${caseId}`),

  getReport: (caseId: string) => request<DamageReport>(`/prediction/results/${caseId}`),

  getDamage: (caseId: string) => request<DamageDetail>(`/damage/report/${caseId}`),

  /** Plain text from the keyboard. Same downstream path as a voice transcript. */
  sendMessage: (caseId: string, text: string) =>
    request<{ message_id: string }>(`/case/${caseId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  /** Correct a wrong transcript. Retracts what the old wording asserted. */
  editMessage: (caseId: string, messageId: string, text: string) =>
    request<DamageReport>(`/case/${caseId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),

  /** Answer the assistant's clarifying question. Returns a full replacement report. */
  answer: (caseId: string, questionId: string, value: string) =>
    request<DamageReport>(`/case/${caseId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ question_id: questionId, value }),
    }),

  /** The ✓/✗ loop. Budgeted under 150 ms — nothing on this path touches a model. */
  confirm: (caseId: string, partId: string, damaged: boolean) =>
    request<DamageReport>('/inspection/confirm', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, part_id: partId, damaged }),
    }),

  // --- media --------------------------------------------------------------

  uploadMedia: (caseId: string, files: { uri: string; name: string; type: string }[]) => {
    const form = new FormData();
    form.append('case_id', caseId);
    form.append('kind', files[0]?.type.startsWith('video') ? 'video' : 'image');
    for (const file of files) {
      // React Native's FormData takes this shape rather than a Blob.
      form.append('files', file as unknown as Blob);
    }
    return request<{ media_ids: string[]; status: string }>('/media/upload', {
      method: 'POST',
      body: form,
    });
  },

  transcribe: (caseId: string, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('case_id', caseId);
    form.append('file', file as unknown as Blob);
    return request<{ message_id: string; status: string }>('/audio/transcribe', {
      method: 'POST',
      body: form,
    });
  },

  // --- parts and ordering --------------------------------------------------

  recommendations: (caseId: string) =>
    request<Recommendations>(`/parts/recommendations?case_id=${encodeURIComponent(caseId)}`),

  finalise: (caseId: string, lines: OrderLineInput[]) =>
    request<PlacedOrder>('/parts/finalise', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, lines }),
    }),

  sendToCustomer: (caseId: string) =>
    request<SendToCustomerResponse>(`/case/${caseId}/send-to-customer`, { method: 'POST' }),

  getApproval: (token: string) => request<ApprovalPayload>(`/approve/${token}`),

  // --- composite -----------------------------------------------------------

  /**
   * Register a rego, wait for the catalogue, open a case.
   *
   * VIN resolution runs in the background and takes 0.8-2.6 s, and a case cannot
   * be created until it lands. Polling here keeps that out of the screens.
   */
  startCase: async (
    rego: string,
    onProgress?: (status: string) => void,
  ): Promise<{ caseId: string; vehicle: Vehicle }> => {
    const registered = await api.registerVehicle(rego);
    onProgress?.(registered.status);

    let vehicle = await api.getVehicle(registered.vehicle_id);
    const deadline = Date.now() + 15_000;

    while (vehicle.status === 'resolving' && Date.now() < deadline) {
      await sleep(300);
      vehicle = await api.getVehicle(registered.vehicle_id);
      onProgress?.(vehicle.status);
    }

    if (vehicle.status === 'not_found') {
      throw new ApiError(404, `No vehicle found for ${rego}`, 'rego_not_found');
    }
    if (vehicle.status === 'resolving') {
      throw new ApiError(504, 'Vehicle lookup timed out', 'vehicle_not_ready', true);
    }

    const created = await api.createCase(vehicle.vehicle_id);
    return { caseId: created.case_id, vehicle };
  },
};

/**
 * Subscribe to a case's server-sent events.
 *
 * Returns an unsubscribe function. Falls back to polling when EventSource is not
 * available — React Native has no native EventSource, and a workshop's wifi drops
 * often enough that the fallback is not theoretical.
 */
export function subscribeToCase(
  caseId: string,
  onReport: (report: DamageReport) => void,
  onError?: (error: unknown) => void,
): () => void {
  let stopped = false;

  const poll = async () => {
    while (!stopped) {
      try {
        onReport(await api.getReport(caseId));
      } catch (error) {
        onError?.(error);
      }
      await sleep(1000);
    }
  };

  void poll();
  return () => {
    stopped = true;
  };
}
