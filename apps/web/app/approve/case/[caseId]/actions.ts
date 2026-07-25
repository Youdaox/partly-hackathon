'use server';

import { backend, BackendError, type FinaliseLine } from '@/lib/backend';

export interface FinaliseResult {
  ok: boolean;
  message?: string;
}

/**
 * Submit the customer's picks.
 *
 * Runs on the server so the prediction backend never has to be publicly reachable —
 * the browser only ever talks to Next.
 */
export async function finaliseOrder(
  caseId: string,
  lines: FinaliseLine[],
): Promise<FinaliseResult> {
  try {
    await backend.finalise(caseId, lines);
    return { ok: true };
  } catch (error) {
    const backendError = error instanceof BackendError ? error : null;
    return {
      ok: false,
      message: backendError?.detail ?? backendError?.message ?? 'Could not submit your choices.',
    };
  }
}
