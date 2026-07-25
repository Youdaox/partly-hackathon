import { forward } from '../../_proxy';

/** The current report: visible / order / check, plus the uploaded media list. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const { caseId } = await params;
  return forward(`/prediction/results/${encodeURIComponent(caseId)}`);
}
