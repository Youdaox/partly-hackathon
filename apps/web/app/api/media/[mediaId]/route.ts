import { API_URL } from '@/lib/api';

/** Streams a stored image back for its thumbnail. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const { mediaId } = await params;
  const upstream = await fetch(`${API_URL}/v1/media/${encodeURIComponent(mediaId)}`, {
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
