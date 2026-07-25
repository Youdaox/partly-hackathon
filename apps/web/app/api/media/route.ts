import { forwardBody } from '../_proxy';

/**
 * Photo upload. The multipart body is streamed through untouched: re-encoding it
 * as JSON would lose the files, and rebuilding the FormData would lose the
 * boundary that separates them.
 */
export async function POST(request: Request): Promise<Response> {
  return forwardBody(
    '/media/upload',
    await request.arrayBuffer(),
    request.headers.get('content-type'),
  );
}
