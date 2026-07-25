'use client';

/**
 * The customer's side of the quote: one supplier choice per part, or decline the part.
 *
 * Offers are pre-selected to whichever the backend marks `recommended`, so a customer who
 * agrees with the recommendation can submit without touching anything.
 */

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { QuoteLine } from '@/lib/backend';
import { finaliseOrder } from './actions';

const BUCKET_LABEL: Record<string, string> = {
  visible: 'You can see these',
  order: "You'll also need these",
  check: 'Checked during teardown',
};

const currency = (cents: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(cents);

export function QuoteForm({ caseId, lines }: { caseId: string; lines: QuoteLine[] }) {
  // Default every line to the recommended offer, falling back to the first.
  const [picks, setPicks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.part_id,
        (line.offers.find((o) => o.recommended) ?? line.offers[0])?.offer_id ?? null,
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const chosen = line.offers.find((o) => o.offer_id === picks[line.part_id]);
        return chosen ? sum + chosen.price_nzd * line.qty : sum;
      }, 0),
    [lines, picks],
  );

  const accepted = lines.filter((line) => picks[line.part_id]).length;

  const submit = () => {
    startTransition(async () => {
      const payload = lines.map((line) => {
        const offerId = picks[line.part_id];
        return offerId
          ? { part_id: line.part_id, offer_id: offerId, qty: line.qty, action: 'accept' as const }
          : { part_id: line.part_id, qty: line.qty, action: 'reject' as const };
      });
      setResult(await finaliseOrder(caseId, payload));
    });
  };

  if (result?.ok) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
          <p className="text-lg font-semibold">Thanks — your repairer has your answer.</p>
          <p className="text-sm text-muted-foreground">
            {accepted} of {lines.length} parts approved.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group by bucket, preserving the backend's ordering within each.
  const buckets = ['visible', 'order', 'check'].filter((b) =>
    lines.some((line) => line.bucket === b),
  );

  return (
    <div className="flex flex-col gap-6">
      {buckets.map((bucket) => (
        <section key={bucket} className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {BUCKET_LABEL[bucket] ?? bucket}
          </h2>

          {lines
            .filter((line) => line.bucket === bucket)
            .map((line) => (
              <Card key={line.part_id}>
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {line.name}
                        {line.qty > 1 ? (
                          <span className="ml-2 text-sm font-medium text-muted-foreground">
                            ×{line.qty}
                          </span>
                        ) : null}
                      </p>
                      {line.part_number ? (
                        <p className="truncate text-xs text-muted-foreground">{line.part_number}</p>
                      ) : null}
                    </div>
                    <Badge variant="secondary">{Math.round(line.p * 100)}%</Badge>
                  </div>

                  <div className="flex flex-col gap-2">
                    {line.offers.map((offer) => {
                      const selected = picks[line.part_id] === offer.offer_id;
                      return (
                        <button
                          key={offer.offer_id}
                          type="button"
                          onClick={() =>
                            setPicks((prev) => ({ ...prev, [line.part_id]: offer.offer_id }))
                          }
                          aria-pressed={selected}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                            selected ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {offer.supplier}
                              <span className="ml-2 text-xs uppercase text-muted-foreground">
                                {offer.kind}
                              </span>
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {offer.lead_days} day{offer.lead_days === 1 ? '' : 's'} ·{' '}
                              {offer.in_stock ? 'in stock' : 'on back order'}
                              {offer.why ? ` · ${offer.why}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold">
                            {currency(offer.price_nzd)}
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => setPicks((prev) => ({ ...prev, [line.part_id]: null }))}
                      aria-pressed={!picks[line.part_id]}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        picks[line.part_id]
                          ? 'border-border text-muted-foreground'
                          : 'border-primary bg-primary/5 font-medium'
                      }`}
                    >
                      Don&apos;t replace this part
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
        </section>
      ))}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">
            {accepted} of {lines.length} parts
          </span>
          <span className="text-lg font-semibold">{currency(total)}</span>
        </div>
        {result && !result.ok ? (
          <p className="text-sm text-destructive">{result.message}</p>
        ) : null}
        <Button onClick={submit} disabled={pending} className="w-full">
          {pending ? 'Sending…' : 'Approve these parts'}
        </Button>
      </div>
    </div>
  );
}
