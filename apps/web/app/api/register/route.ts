import { forward } from '../_proxy';

/** Rego -> a vehicle the backend starts resolving. Rejects the nine uncatalogued plates. */
export async function POST(request: Request): Promise<Response> {
  return forward('/vehicle/register', { method: 'POST', body: await request.text() });
}
