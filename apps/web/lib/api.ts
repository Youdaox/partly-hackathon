/**
 * Server-side API client.
 *
 * Used from React Server Components, so it talks to the API over the internal URL
 * (`API_URL`) rather than anything the browser sees. The browser posts approvals
 * through the server action in `app/approve/[jobId]/actions.ts`, which means the
 * API never has to be publicly reachable.
 */

import type { ApprovalPayload, ApprovalPick, CaseListItem } from '@partli/shared';

export const API_URL = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const V1 = `${API_URL}/v1`;

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
    response = await fetch(`${V1}${path}`, {
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
      `Tried ${V1}. Is it running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // One error envelope everywhere: { error: { code, message, retryable } }.
    const envelope = body?.error;
    throw new ApiError(
      response.status,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.code,
    );
  }

  return body as T;
}

export const api = {
  /**
   * Approval links are addressed by an unguessable token, not by case id: a
   * customer receives this URL by text and must not be able to walk it to
   * someone else's job by editing it.
   */
  getApproval: (token: string) => request<ApprovalPayload>(`/approve/${token}`),

  submitApproval: (token: string, optionId: string) =>
    request<ApprovalPayload>(`/approve/${token}`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    }),

  /** The per-part form: a pick (or an explicit no) for every line. */
  submitApprovalPicks: (token: string, picks: ApprovalPick[]) =>
    request<ApprovalPayload>(`/approve/${token}`, {
      method: 'POST',
      body: JSON.stringify({ lines: picks }),
    }),

  listCases: async (): Promise<CaseListItem[]> => {
    const body = await request<{ cases: CaseListItem[] }>('/cases');
    return body.cases;
  },
};
