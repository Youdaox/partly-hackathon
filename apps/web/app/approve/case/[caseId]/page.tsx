/**
 * Customer approval, driven by the prediction backend.
 *
 * The case id in the URL is the secret — no login, mobile-first. Every line comes from
 * `/v1/parts/recommendations`, which returns all three report sections with supplier
 * offers attached, so the customer sees what the repairer can see and why.
 */

import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { backend, BackendError } from '@/lib/backend';
import { QuoteForm } from './quote-form';

export const metadata: Metadata = {
  title: 'Approve your repair — Partli',
};

// The quote changes as the repairer confirms parts; never serve it stale.
export const dynamic = 'force-dynamic';

export default async function ApproveCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  let quote;
  try {
    quote = await backend.getQuote(caseId);
  } catch (error) {
    const backendError = error instanceof BackendError ? error : null;
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>{backendError?.message ?? 'Something went wrong'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {backendError?.detail ??
                'We could not load your repair options. Please check the link your repairer sent you.'}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Partli</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your repair options</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a supplier for each part, or tell us to leave it. Nothing is ordered until you
          approve.
        </p>
        {quote.simulated ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Prices and lead times are simulated — the dataset carries no commercial data.
          </p>
        ) : null}
      </header>

      {quote.lines.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            There is nothing to approve on this job yet.
          </CardContent>
        </Card>
      ) : (
        <QuoteForm caseId={caseId} lines={quote.lines} />
      )}
    </main>
  );
}
