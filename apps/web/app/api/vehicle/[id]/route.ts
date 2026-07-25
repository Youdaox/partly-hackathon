import { forward } from '../../_proxy';

/** Polled while the simulated VIN lookup runs, until `status` leaves `resolving`. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return forward(`/vehicle/${encodeURIComponent(id)}`);
}
