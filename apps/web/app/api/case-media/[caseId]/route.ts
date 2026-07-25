import { forward } from '../../_proxy';

/** Everything uploaded to a case, oldest first — proof the upload landed. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const { caseId } = await params;
  return forward(`/case/${encodeURIComponent(caseId)}/media`);
}
