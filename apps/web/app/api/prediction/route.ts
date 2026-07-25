import { forward } from '../_proxy';

/** Re-runs the propagation for a case. */
export async function POST(request: Request): Promise<Response> {
  return forward('/prediction/run', { method: 'POST', body: await request.text() });
}
