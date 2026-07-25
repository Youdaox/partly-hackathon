import { forward } from '../_proxy';

/** The three regos a case may be opened against, so the page need not hardcode them. */
export async function GET(): Promise<Response> {
  return forward('/vehicles/allowed');
}
