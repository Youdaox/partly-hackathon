/**
 * Server-side API client.
 *
 * Used from React Server Components, so it talks to the API over the internal URL
 * (`API_URL`) rather than anything the browser sees. The browser posts approvals
 * through the server action in `app/approve/[jobId]/actions.ts`, which means the
 * API never has to be publicly reachable.
 */

import type { ApprovalPayload, Job, VehicleSummary } from '@first-look/shared';

export const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

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
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      // Job state changes constantly during a demo; never serve a stale quote.
      cache: 'no-store',
    });
  } catch (error) {
    throw new ApiError(
      0,
      'Cannot reach the API',
      `Tried ${API_URL}. Is it running? (${
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
  getApproval: (jobId: string) => request<ApprovalPayload>(`/api/approve/${jobId}`),

  submitApproval: (jobId: string, optionId: string) =>
    request<ApprovalPayload>(`/api/approve/${jobId}`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  listJobs: () => request<Array<Job & { vehicle: VehicleSummary }>>('/api/jobs'),
};
