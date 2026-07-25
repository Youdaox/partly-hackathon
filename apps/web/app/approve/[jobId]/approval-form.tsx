'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Clock, ShieldCheck } from 'lucide-react';
import { formatPrice, type ApprovalLineItem } from '@partli/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { approveOption, type ApproveState } from './actions';

interface ApprovalFormProps {
  jobId: string;
  lineItems: ApprovalLineItem[];
  approvedOption: string | null;
}

const TIER_BLURB: Record<string, string> = {
  oem: 'Made by the manufacturer. Exact fit and finish.',
  aftermarket: 'Made by an independent supplier. Cheaper, arrives sooner.',
  used: 'Recycled from a donor vehicle. Lowest cost, longest wait.',
};

function SubmitButton({ selected }: { selected: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={!selected || pending}>
      {pending ? 'Sending…' : selected ? 'Approve these repairs' : 'Choose an option above'}
    </Button>
  );
}

export function ApprovalForm({ jobId, lineItems, approvedOption }: ApprovalFormProps) {
  const [state, formAction] = useActionState<ApproveState, FormData>(approveOption, {
    error: null,
  });

  // The API records one approved option per job, so the customer picks a supply
  // tier once and it applies to the whole quote.
  const tiers = Array.from(
    new Map(
      lineItems
        .flatMap((item) => item.options)
        .map((option) => [option.tier, option] as const),
    ).values(),
  );

  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const totalFor = (tier: string) =>
    lineItems.reduce((sum, item) => {
      const match = item.options.find((option) => option.tier === tier) ?? item.options[0];
      return sum + (match?.priceCents ?? 0);
    }, 0);

  const longestEta = (tier: string) =>
    lineItems.reduce((max, item) => {
      const match = item.options.find((option) => option.tier === tier) ?? item.options[0];
      return Math.max(max, match?.etaDays ?? 0);
    }, 0);

  /**
   * The option id posted back must be one the API actually offered, so send the id
   * of the selected tier's option on the first line item.
   */
  const selectedOptionId = selectedTier
    ? (lineItems[0]?.options.find((option) => option.tier === selectedTier)?.id ?? null)
    : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="optionId" value={selectedOptionId ?? ''} />

      <fieldset className="space-y-3" disabled={Boolean(approvedOption)}>
        <legend className="sr-only">Choose a parts option</legend>

        {tiers.map((option) => {
          const total = totalFor(option.tier);
          const eta = longestEta(option.tier);
          const checked = selectedTier === option.tier;

          return (
            <label
              key={option.tier}
              className={cn(
                'block cursor-pointer rounded-xl border-2 p-4 transition-colors',
                checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
              )}
            >
              <input
                type="radio"
                name="tier"
                value={option.tier}
                checked={checked}
                onChange={() => setSelectedTier(option.tier)}
                className="sr-only"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{option.label}</span>
                    {checked ? <Check className="text-primary" aria-hidden /> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {TIER_BLURB[option.tier] ?? ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" aria-hidden />
                      Ready in about {eta} days
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      {option.warranty} warranty
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold tabular-nums">
                    {formatPrice(total, option.currency)}
                  </div>
                  <div className="text-xs text-muted-foreground">for {lineItems.length} parts</div>
                </div>
              </div>
            </label>
          );
        })}
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {approvedOption ? null : <SubmitButton selected={Boolean(selectedOptionId)} />}

      {/* Per-part breakdown, collapsed by default so the choice stays the focus. */}
      <details className="pt-2">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          See the {lineItems.length} parts in this quote
        </summary>
        <Card className="mt-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Parts breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lineItems.map((item) => (
              <div key={item.partId} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{item.displayName}</span>
                    {item.kind === 'hidden' ? (
                      <Badge variant="success" className="shrink-0">
                        Found by Partli
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {selectedTier
                    ? formatPrice(
                        (item.options.find((o) => o.tier === selectedTier) ?? item.options[0])
                          ?.priceCents ?? 0,
                      )
                    : '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </details>
    </form>
  );
}
