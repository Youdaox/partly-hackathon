'use client';

/**
 * The customer's side of the quote: one supplier choice per part, or decline the part.
 *
 * Offers are pre-selected to whichever the backend marks `recommended`, so a customer
 * who agrees with the recommendation can submit without touching anything.
 *
 * Ported from the case-id-addressed page onto the token flow: the quote is fetched and
 * submitted via `/v1/approve/{token}`, so the link a customer holds cannot be walked to
 * another job by editing the URL.
 */

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatLeadTime, formatPrice, type ApprovalLine, type ApprovalPick } from '@partli/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { approvePicks } from './actions';

const KIND_LABEL: Record<string, string> = {
  visible: 'Seen on your vehicle',
  hidden: 'Found before teardown',
};

const KIND_INTRO: Record<string, string> = {
  visible: 'Damage in the photos of your car. Confirmed, not estimated.',
  hidden: 'Parts behind the panels, predicted from where the impact landed.',
};

/**
 * Confidence, in the three bands a decision actually has.
 *
 * Shown for predicted parts only. A part in `visible` is damage a customer can
 * see in their own photos, and putting "95%" beside it invites them to wonder
 * about the other 5% of something that is not in doubt. Matches the repairer's
 * app, so the two sides of the same job read the same way.
 */
function Likelihood({ p }: { p: number }) {
  const [label, tone] =
    p >= 0.8
      ? ['Very likely', 'default' as const]
      : p >= 0.6
        ? ['Likely', 'secondary' as const]
        : ['Possible', 'outline' as const];
  return <Badge variant={tone}>{label}</Badge>;
}

export function QuoteForm({ token, lines }: { token: string; lines: ApprovalLine[] }) {
  // Default every line to the recommended option, falling back to the first.
  const [picks, setPicks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.part_id,
        (line.options.find((o) => o.recommended) ?? line.options[0])?.id ?? null,
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const chosen = line.options.find((o) => o.id === picks[line.part_id]);
        return chosen ? sum + chosen.price_nzd * line.qty : sum;
      }, 0),
    [lines, picks],
  );

  const accepted = lines.filter((line) => picks[line.part_id]).length;

  const submit = () => {
    startTransition(async () => {
      const payload: ApprovalPick[] = lines.map((line) => {
        const offerId = picks[line.part_id];
        return offerId
          ? { part_id: line.part_id, offer_id: offerId, action: 'accept' as const }
          : { part_id: line.part_id, action: 'reject' as const };
      });
      setResult(await approvePicks(token, payload));
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

  // Group by kind, preserving the backend's ordering within each.
  const kinds = ['visible', 'hidden'].filter((k) => lines.some((line) => line.kind === k));

  return (
    <div className="flex flex-col gap-6">
      {kinds.map((kind) => (
        <section key={kind} className="flex flex-col gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {KIND_LABEL[kind] ?? kind}
            </h2>
            {KIND_INTRO[kind] ? (
              <p className="mt-1 text-xs text-muted-foreground">{KIND_INTRO[kind]}</p>
            ) : null}
          </div>

          {lines
            .filter((line) => line.kind === kind)
            .map((line) => (
              <Card key={line.part_id}>
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {line.display_name}
                        {line.qty > 1 ? (
                          <span className="ml-2 text-sm font-medium text-muted-foreground">
                            ×{line.qty}
                          </span>
                        ) : null}
                      </p>
                      {line.part_number ? (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {line.part_number.split(':').pop()}
                        </p>
                      ) : null}
                    </div>
                    {line.kind === 'visible' ? (
                      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Detected
                      </span>
                    ) : (
                      <Likelihood p={line.p} />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {line.options.map((option) => {
                      const selected = picks[line.part_id] === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setPicks((prev) => ({ ...prev, [line.part_id]: option.id }))
                          }
                          aria-pressed={selected}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                            selected ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {option.label}
                              <span className="ml-2 text-xs uppercase text-muted-foreground">
                                {option.tier}
                              </span>
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {formatLeadTime(option.lead_days)} ·{' '}
                              {option.in_stock ? 'in stock' : 'on back order'}
                              {option.why ? ` · ${option.why}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold">
                            {formatPrice(option.price_nzd)}
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
          <span className="text-lg font-semibold">{formatPrice(total)}</span>
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
