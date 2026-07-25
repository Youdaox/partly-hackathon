'use server';

import { revalidatePath } from 'next/cache';
import type { ApprovalPick } from '@partli/shared';

import { ApiError, api } from '@/lib/api';

export interface ApproveResult {
  ok: boolean;
  message?: string;
}

/**
 * Submit the customer's per-part picks.
 *
 * A server action rather than a browser fetch, so the backend only has to be
 * reachable from the Next.js server — the customer's phone never talks to it
 * directly, and the quote stays addressed by its unguessable token.
 */
export async function approvePicks(
  token: string,
  picks: ApprovalPick[],
): Promise<ApproveResult> {
  if (!token || picks.length === 0) {
    return { ok: false, message: 'Nothing to submit.' };
  }

  try {
    await api.submitApprovalPicks(token, picks);
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.detail ? `${error.message} (${error.detail})` : error.message,
      };
    }
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }

  revalidatePath(`/approve/${token}`);
  return { ok: true };
}
