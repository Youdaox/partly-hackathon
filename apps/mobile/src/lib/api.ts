/**
 * Typed client for the Partli API.
 *
 * Types come from `@partli/shared`, so a change to the API contract shows up
 * here as a compile error rather than a runtime surprise.
 */

import Constants from 'expo-constants';
import type {
  ApprovalPayload,
  DamageItem,
  DamageSource,
  HiddenDamagePrediction,
  Job,
  JobState,
  SendToCustomerResponse,
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
  if (host) return `http://${host}:4000`;

  return 'http://localhost:4000';
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(
      0,
      'Cannot reach the API',
      `Tried ${API_BASE_URL}. Is it running, and is your phone on the same network? ` +
        `Set EXPO_PUBLIC_API_URL to override. (${
          error instanceof Error ? error.message : String(error)
        })`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? `Request failed (${response.status})`,
      body?.detail,
    );
  }

  return body as T;
}

export const api = {
  listVehicles: () => request<VehicleSummary[]>('/api/vehicles'),

  listJobs: () => request<(Job & { vehicle: VehicleSummary })[]>('/api/jobs'),

  createJob: (vehicleSlug: string, seedFromPrediction = false) =>
    request<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ vehicleSlug, seedFromPrediction }),
    }),

  getJob: (jobId: string) => request<JobState>(`/api/jobs/${jobId}`),

  /** Add visible damage from free text (voice or typed). */
  addDamage: (jobId: string, rawText: string, source: DamageSource = 'voice') =>
    request<DamageItem>(`/api/jobs/${jobId}/damage`, {
      method: 'POST',
      body: JSON.stringify({ rawText, source }),
    }),

  removeDamage: (jobId: string, damageId: string) =>
    request<void>(`/api/jobs/${jobId}/damage/${damageId}`, { method: 'DELETE' }),

  predictHiddenDamage: (jobId: string, limit = 10) =>
    request<{ predictions: HiddenDamagePrediction[] }>(`/api/jobs/${jobId}/oracle/predict`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  confirmHiddenDamage: (jobId: string, predictionId: string, confirmed: boolean) =>
    request<HiddenDamagePrediction>(`/api/jobs/${jobId}/oracle/confirm`, {
      method: 'POST',
      body: JSON.stringify({ predictionId, confirmed }),
    }),

  sendToCustomer: (jobId: string) =>
    request<SendToCustomerResponse>(`/api/jobs/${jobId}/send-to-customer`, { method: 'POST' }),

  getApproval: (jobId: string) => request<ApprovalPayload>(`/api/approve/${jobId}`),
};
