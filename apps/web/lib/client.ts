/**
 * Browser-side API client for the capture flow.
 *
 * The mirror of `lib/api.ts`: that one runs on the server and talks to the
 * backend directly, this one runs in the browser and talks only to the route
 * handlers under `app/api/*`. Nothing here knows the backend's address.
 *
 * Every call funnels through `call`, so the backend's error envelope becomes an
 * `ApiError` with its original code — the page shows `rego_not_allowed` as the
 * sentence the backend wrote, rather than a generic failure.
 */

import type {
  AllowedVehicle,
  DamageReport,
  MediaAsset,
  RegisterVehicleResponse,
  Vehicle,
} from '@partli/shared';

import { ApiError } from './api';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && typeof init.body === 'string'
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const envelope = body?.error;
    throw new ApiError(
      response.status,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.code,
    );
  }
  return body as T;
}

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export const client = {
  /** The three vehicles that ship a full OEM catalogue. */
  allowedVehicles: async (): Promise<AllowedVehicle[]> =>
    (await call<{ vehicles: AllowedVehicle[] }>('/api/allowed')).vehicles,

  registerVehicle: (rego: string) =>
    call<RegisterVehicleResponse>('/api/register', json({ rego })),

  getVehicle: (vehicleId: string) => call<Vehicle>(`/api/vehicle/${vehicleId}`),

  createCase: (vehicleId: string) =>
    call<{ case_id: string }>('/api/case', json({ vehicle_id: vehicleId })),

  /**
   * Photos. Sent as multipart because they are files — the route handler
   * streams the body through so the parts survive the hop.
   */
  uploadPhotos: async (caseId: string, files: File[]): Promise<MediaAsset[]> => {
    const form = new FormData();
    form.append('case_id', caseId);
    form.append('kind', 'image');
    for (const file of files) form.append('files', file, file.name);
    const body = await call<{ media: MediaAsset[] }>('/api/media', {
      method: 'POST',
      body: form,
    });
    return body.media;
  },

  listPhotos: async (caseId: string): Promise<MediaAsset[]> =>
    (await call<{ media: MediaAsset[] }>(`/api/case-media/${caseId}`)).media,

  /** Where a stored photo's bytes come from, for the thumbnail. */
  photoUrl: (mediaId: string) => `/api/media/${mediaId}`,

  runPrediction: (caseId: string) =>
    call<{ prediction_id: string; computed_ms: number }>(
      '/api/prediction',
      json({ case_id: caseId }),
    ),

  getReport: (caseId: string) => call<DamageReport>(`/api/results/${caseId}`),

  /** A tick or a cross. Returns the whole replacement report. */
  confirmPart: (caseId: string, partId: string, damaged: boolean) =>
    call<DamageReport>('/api/confirm', json({ case_id: caseId, part_id: partId, damaged })),

  answerQuestion: (caseId: string, questionId: string, value: string) =>
    call<DamageReport>('/api/answer', json({ case_id: caseId, question_id: questionId, value })),
};

/** Poll the vehicle until the simulated VIN lookup finishes. */
export async function waitForVehicle(
  vehicleId: string,
  { timeoutMs = 20_000, intervalMs = 400 } = {},
): Promise<Vehicle> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const vehicle = await client.getVehicle(vehicleId);
    if (vehicle.status !== 'resolving') return vehicle;
    if (Date.now() > deadline) {
      throw new ApiError(504, 'The VIN lookup is taking longer than expected.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export { ApiError };
