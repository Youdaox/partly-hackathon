'use server';

import { revalidatePath } from 'next/cache';

import { ApiError, api } from '@/lib/api';

export interface ApproveState {
  error: string | null;
}

/**
 * Submit the customer's chosen option.
 *
 * A server action rather than a browser fetch, so the API only has to be reachable
 * from the Next.js server — the customer's phone never talks to it directly.
 */
export async function approveOption(
  _prevState: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const token = String(formData.get('token') ?? '');
  const optionId = String(formData.get('optionId') ?? '');

  if (!token || !optionId) {
    return { error: 'Missing quote or option.' };
  }

  try {
    await api.submitApproval(token, optionId);
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.detail ? `${error.message} — ${error.detail}` : error.message };
    }
    return { error: 'Something went wrong. Please try again.' };
  }

  revalidatePath(`/approve/${token}`);
  return { error: null };
}
