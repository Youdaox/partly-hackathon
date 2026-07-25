import { forward } from '../_proxy';

/** Answers the one clarifying question, which re-runs the prediction. */
export async function POST(request: Request): Promise<Response> {
  const { case_id: caseId, ...rest } = await request.json();
  return forward(`/case/${encodeURIComponent(caseId)}/answers`, {
    method: 'POST',
    body: JSON.stringify(rest),
  });
}
