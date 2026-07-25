/**
 * The one place the browser's requests cross into the backend.
 *
 * `lib/api.ts` is for server components and talks to `API_URL` directly. The
 * capture page is a client component, so it needs an origin the browser can
 * reach — these handlers are it. They forward a deliberately narrow set of
 * calls rather than exposing `/v1/*` wholesale, which means the surface the
 * page can reach is the surface listed in `app/api/`, and `API_URL` stays a
 * server-only value.
 *
 * Errors keep the backend's envelope (`{ error: { code, message } }`) and its
 * status, so the page can render `rego_not_allowed` as the sentence the
 * backend wrote instead of inventing its own wording.
 */

import { API_URL } from '@/lib/api';

const V1 = `${API_URL}/v1`;

/** The envelope the backend sends, and the shape the client parses back out. */
function errorBody(message: string, code: string, retryable = false) {
  return { error: { code, message, retryable } };
}

/** Forward a JSON request and hand the backend's answer straight back. */
export async function forward(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${V1}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      // A case changes on every upload and every tick; never serve a stale one.
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      errorBody(
        `Cannot reach the prediction API at ${V1}. Is it running? ` +
          '(backend/.venv/bin/uvicorn app.main:app --port 8080)',
        'api_unreachable',
        true,
      ),
      { status: 503 },
    );
  }

  const text = await upstream.text();
  return new Response(text || null, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

/** Forward a request body verbatim — used for multipart uploads. */
export async function forwardBody(
  path: string,
  body: BodyInit,
  contentType: string | null,
): Promise<Response> {
  return forward(path, {
    method: 'POST',
    body,
    // Multipart must keep its boundary parameter, so the incoming header is
    // passed through rather than rebuilt.
    headers: contentType ? { 'content-type': contentType } : undefined,
  });
}
