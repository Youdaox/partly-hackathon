'use client';

/**
 * The customer's side of the quote: three whole-job plans rather than a supplier choice per
 * part. Somebody whose car is off the road wants to trade money against time once, not
 * twenty times.
 *
 * The plans are *derived from the offers*, never asserted. Each part carries real prices,
 * lead times and stock flags, so "cheapest" and "fastest" fall out of the data — which also
 * means the page cannot claim a trade-off the quote does not actually contain.
 *
 * Submission is still per-part: a plan is just a way of choosing one offer per line, so the
 * repairer receives exactly which supplier was accepted for every part.
 */

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Clock, Wrench } from 'lucide-react';
import { formatPrice, type ApprovalLine, type ApprovalOption, type ApprovalPick } from '@partli/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { approvePicks } from './actions';

/** Days in the workshop once every part has landed. Simulated, like the pricing. */
const FITTING_DAYS = 3;

type PlanId = 'budget' | 'balanced' | 'genuine';

interface Plan {
  id: PlanId;
  title: string;
  blurb: string;
  /** part_id -> chosen offer. */
  choices: Map<string, ApprovalOption>;
  total: number;
  /** The job waits on its slowest part, so this is a max and not a sum. */
  leadDays: number;
  genuineCount: number;
}

/** Cheapest offer for a line, used as the fallback everywhere. */
function cheapestOf(options: ApprovalOption[]): ApprovalOption | undefined {
  return [...options].sort((a, b) => a.price_nzd - b.price_nzd)[0];
}

function buildPlan(
  id: PlanId,
  title: string,
  blurb: string,
  lines: ApprovalLine[],
  choose: (options: ApprovalOption[]) => ApprovalOption | undefined,
): Plan {
  const choices = new Map<string, ApprovalOption>();
  let total = 0;
  let leadDays = 0;
  let genuineCount = 0;

  for (const line of lines) {
    if (line.options.length === 0) continue;
    const chosen = choose(line.options) ?? cheapestOf(line.options);
    if (!chosen) continue;

    choices.set(line.part_id, chosen);
    total += chosen.price_nzd * line.qty;
    leadDays = Math.max(leadDays, chosen.lead_days);
    if (chosen.tier === 'oem') genuineCount += 1;
  }

  return { id, title, blurb, choices, total, leadDays, genuineCount };
}

/** "Tue 12 Aug" — the day the car is realistically back, not the parts ETA. */
function readyDate(leadDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + leadDays + FITTING_DAYS);
  return date.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function QuoteForm({ token, lines }: { token: string; lines: ApprovalLine[] }) {
  const plans = useMemo<Plan[]>(() => {
    const quotable = lines.filter((line) => line.options.length > 0);

    return [
      buildPlan(
        'budget',
        'Best price',
        'Aftermarket parts wherever they are available.',
        quotable,
        cheapestOf,
      ),
      buildPlan(
        'balanced',
        'Recommended',
        'Our pick per part, balancing price against how soon we can get it.',
        quotable,
        (options) => options.find((o) => o.recommended),
      ),
      buildPlan(
        'genuine',
        'All genuine parts',
        'Manufacturer parts throughout, where the maker supplies one.',
        quotable,
        (options) => cheapestOf(options.filter((o) => o.tier === 'oem')),
      ),
    ];
  }, [lines]);

  const [selected, setSelected] = useState<PlanId>('balanced');
  const [showParts, setShowParts] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const plan = plans.find((p) => p.id === selected) ?? plans[1];
  const cheapest = Math.min(...plans.map((p) => p.total));
  const soonest = Math.min(...plans.map((p) => p.leadDays));

  const submit = () => {
    startTransition(async () => {
      const picks: ApprovalPick[] = lines.map((line) => {
        const chosen = plan.choices.get(line.part_id);
        return chosen
          ? { part_id: line.part_id, offer_id: chosen.id, action: 'accept' as const }
          : { part_id: line.part_id, action: 'reject' as const };
      });
      setResult(await approvePicks(token, picks));
    });
  };

  if (result?.ok) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <p className="text-lg font-semibold">Thanks — your repairer has your answer.</p>
          <p className="text-sm text-muted-foreground">
            {plan.title} · {formatPrice(plan.total)} · back with you around{' '}
            {readyDate(plan.leadDays)}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {plans.map((option) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setSelected(option.id)}
            aria-pressed={active}
            className={`rounded-xl border p-4 text-left transition ${
              active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{option.title}</span>
              <span className="text-lg font-semibold">{formatPrice(option.total)}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {option.total === cheapest ? <Badge variant="success">Lowest price</Badge> : null}
              {option.leadDays === soonest ? <Badge variant="secondary">Back soonest</Badge> : null}
              {option.genuineCount > 0 ? (
                <Badge variant="secondary">
                  {option.genuineCount} genuine part{option.genuineCount === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </div>

            <p className="mt-2 text-sm text-muted-foreground">{option.blurb}</p>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-4 shrink-0" aria-hidden />
                {option.leadDays === 0
                  ? 'Parts in stock'
                  : `Longest part takes ${option.leadDays} days`}
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <Wrench className="size-4 shrink-0" aria-hidden />
                Car ready ~{readyDate(option.leadDays)}
              </span>
            </div>
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setShowParts((open) => !open)}
        className="self-start text-sm font-medium text-primary"
      >
        {showParts ? 'Hide the parts' : `See all ${plan.choices.size} parts`}
      </button>

      {showParts ? (
        <Card>
          <CardContent className="divide-y p-0">
            {lines.map((line) => {
              const chosen = plan.choices.get(line.part_id);
              return (
                <div key={line.part_id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {line.qty > 1 ? `${line.qty}× ` : ''}
                      {line.display_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chosen ? `${chosen.label} · ${chosen.tier}` : 'No supplier available'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm">
                    {chosen ? formatPrice(chosen.price_nzd * line.qty) : '—'}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-4">
        {result && !result.ok ? (
          <p className="text-sm text-destructive">{result.message}</p>
        ) : null}
        <Button onClick={submit} disabled={pending} className="w-full">
          {pending ? 'Sending…' : `Approve ${plan.title} — ${formatPrice(plan.total)}`}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Your repairer confirms the final price before any work starts.
        </p>
      </div>
    </div>
  );
}
