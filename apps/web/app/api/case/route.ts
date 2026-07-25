import { forward } from '../_proxy';

/** Opens a case. Seeds it from the shipped interpreter output, so the first report is populated. */
export async function POST(request: Request): Promise<Response> {
  return forward('/case', { method: 'POST', body: await request.text() });
}
