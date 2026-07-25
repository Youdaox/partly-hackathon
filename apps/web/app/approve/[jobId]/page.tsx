/**
 * Public customer approval page.
 *
 * Opened from a QR code on the repairer's phone, so it is designed mobile-first and
 * needs no login — the job id in the URL is the secret.
 */

import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { ApprovalForm } from './approval-form';

export const metadata: Metadata = {
  title: 'Approve your repair — First Look',
};

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  let payload;
  try {
    payload = await api.getApproval(jobId);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>{apiError?.message ?? 'Something went wrong'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {apiError?.detail ??
                'We could not load your repair options. Please check the link your repairer sent you.'}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { vehicle, lineItems, approvedOption, approvedAt } = payload;
  const hiddenCount = lineItems.filter((item) => item.kind === 'hidden').length;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">First Look</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Your repair options are ready
        </h1>
        {vehicle ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {vehicle.make.toUpperCase()} {vehicle.model}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </p>
        ) : null}
      </header>

      {approvedOption ? (
        <Card className="mb-6 border-success">
          <CardContent className="flex items-start gap-3 p-5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-medium">Thanks — your approval is in.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your repairer has been notified and will order the parts.
                {approvedAt
                  ? ` Approved ${new Date(approvedAt).toLocaleString('en-NZ', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}.`
                  : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {lineItems.length} parts need replacing
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hiddenCount > 0 ? (
            <div className="flex items-start gap-2">
              <Badge variant="success" className="mt-0.5 shrink-0">
                {hiddenCount} found early
              </Badge>
              <p className="text-sm text-muted-foreground">
                Our assessment found {hiddenCount === 1 ? 'a part' : 'parts'} likely damaged
                behind the visible panels. Catching {hiddenCount === 1 ? 'it' : 'them'} now
                avoids a second delay once your car is stripped down.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Every part below was identified during your vehicle&apos;s assessment.
            </p>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        Choose how you&apos;d like these parts supplied
      </h2>

      <ApprovalForm jobId={jobId} lineItems={lineItems} approvedOption={approvedOption} />

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Prices are indicative and confirmed by your repairer before any work starts.
      </p>
    </main>
  );
}
