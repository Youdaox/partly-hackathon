/**
 * Server-side client for the FastAPI prediction backend (`backend/`, port 8080).
 *
 * Used from React Server Components and server actions, so it talks over an internal URL
 * the browser never sees. That is what lets the customer approval page work without the
 * backend being publicly reachable.
 */

export const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');

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

/** One quotable line, across all three report sections. */
export interface QuoteLine {
  part_id: string;
  part_number: string | null;
  name: string;
  p: number;
  /** `visible` | `order` | `check` */
  bucket: string;
  qty: number;
  offers: Offer[];
}

export interface Quote {
  lines: QuoteLine[];
  /** Always true in this build: no price or supplier field exists in the dataset. */
  simulated: boolean;
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
    response = await fetch(`${BACKEND_URL}/v1${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      // The prediction changes on every confirmation; never serve a stale quote.
      cache: 'no-store',
    });
  } catch (error) {
    throw new BackendError(
      0,
      'Cannot reach the prediction backend',
      `Tried ${BACKEND_URL}. Is uvicorn running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : undefined;
    throw new BackendError(
      response.status,
      body?.error ?? body?.message ?? `Request failed (${response.status})`,
      detail,
    );
  }

  return body as T;
}

export interface FinaliseLine {
  part_id: string;
  offer_id?: string;
  qty?: number;
  action?: 'accept' | 'reject' | 'modify';
}

export const backend = {
  /** Every line of the report with supplier offers attached. */
  getQuote: (caseId: string) =>
    request<Quote>(`/parts/recommendations?case_id=${encodeURIComponent(caseId)}`),

  finalise: (caseId: string, lines: FinaliseLine[]) =>
    request<unknown>('/parts/finalise', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, lines }),
    }),
};
