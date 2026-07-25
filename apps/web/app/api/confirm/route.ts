import { forward } from '../_proxy';

/** The tick/cross loop. Returns a whole replacement report, not a patch. */
export async function POST(request: Request): Promise<Response> {
  return forward('/inspection/confirm', { method: 'POST', body: await request.text() });
}
