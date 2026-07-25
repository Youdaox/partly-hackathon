'use client';

import { useState } from 'react';
import { Camera, Check, ChevronDown, Eye, X } from 'lucide-react';
import { formatProbability, type ReportLine } from '@partli/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The two columns, and the one rule that separates them.
 *
 * A part in `visible` was seen — by Partly's interpreter in the photos, or by
 * the repairer ticking it. It is a fact, so it carries no percentage: printing
 * "95%" next to a bumper cover that is visibly in pieces reads as hedging, and
 * it blurs the only distinction that matters here. A part in `order` was never
 * seen by anything; it is there because the graph put it there, so it shows
 * what the engine actually believes.
 *
 * Observed = no number. Predicted = number.
 */

function PartNumber({ line }: { line: ReportLine }) {
  if (!line.part_number) return null;
  // The manufacturer number is the thing a repairer phones through, and it is
  // the proof that this is a real catalogue part rather than a category.
  return (
    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
      {line.part_number.split(':').pop()}
    </span>
  );
}

/**
 * `X% match`, in the three tiers the mobile app uses — filled at 75+, outlined
 * at 50+, quiet below — so 95% and 38% do not read as equally urgent.
 *
 * Numerical rather than a High/Medium/Low word: those are different decisions
 * to a repairer, and a band flattens them into the same label. Only ever
 * rendered for predictions; observed parts carry no number at all.
 */
function MatchBadge({ p }: { p: number }) {
  const percent = Math.round(p * 100);
  const tier =
    percent >= 75
      ? 'bg-primary/10 text-primary border-transparent'
      : percent >= 50
        ? 'border-primary text-primary'
        : 'bg-secondary text-muted-foreground border-transparent';

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${tier}`}
    >
      {percent}% match
    </span>
  );
}

/** Fasteners and sub-components, folded away until asked for. */
function Hardware({ items }: { items: ReportLine[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        {open ? 'Hide' : `+ ${items.length}`} fastener{items.length === 1 ? '' : 's'} &amp; seals
      </button>
      {open ? (
        <ul className="mt-1.5 space-y-1 border-l pl-3">
          {items.map((item) => (
            <li key={item.part_id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {item.name}
                {item.qty > 1 ? ` ×${item.qty}` : ''}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatProbability(item.p)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Camera saw — Partly": observed damage. Deliberately plain and muted — this
 * is the half everyone can already see.
 */
export function VisibleColumn({ lines }: { lines: ReportLine[] }) {
  return (
    <section aria-labelledby="visible-heading">
      <header className="mb-3 flex items-center gap-2">
        <Camera className="size-4 text-muted-foreground" aria-hidden />
        <h2 id="visible-heading" className="text-sm font-medium text-muted-foreground">
          Camera saw — Partly
        </h2>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">
        Damage identified in the photos. Observed, so no probability.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
          Nothing detected yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li
              key={line.part_id}
              className="rounded-lg border border-dashed bg-muted/30 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {line.name}
                  {line.qty > 1 ? ` ×${line.qty}` : ''}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Detected
                </span>
              </div>
              <PartNumber line={line} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Hidden — we predict": the star. Parts in no photo, ranked by how likely the
 * engine thinks they are, each naming the part that put it there.
 */
export function HiddenColumn({
  lines,
  onConfirm,
  busyPartId,
}: {
  lines: ReportLine[];
  onConfirm: (partId: string, damaged: boolean) => void;
  busyPartId: string | null;
}) {
  return (
    <section aria-labelledby="hidden-heading">
      <header className="mb-3 flex items-center gap-2">
        <Eye className="size-4 text-primary" aria-hidden />
        <h2 id="hidden-heading" className="text-sm font-semibold">
          Hidden — we predict
        </h2>
        <Badge variant="secondary">{lines.length}</Badge>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">
        In no photo. Ranked by how likely they are to need replacing. Tick or cross one and
        the list re-propagates.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
          Nothing above the order threshold for this vehicle.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => (
            <li
              key={line.part_id}
              className={cn(
                'rounded-xl border bg-card p-3 shadow-sm transition-all duration-300',
                busyPartId === line.part_id && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {line.name}
                  {line.qty > 1 ? ` ×${line.qty}` : ''}
                </p>
                <MatchBadge p={line.p} />
              </div>

              {line.reason ? (
                <p className="mt-1.5 text-xs text-muted-foreground">{line.reason}</p>
              ) : null}
              <PartNumber line={line} />

              <Hardware items={line.hardware ?? []} />

              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  disabled={busyPartId !== null}
                  onClick={() => onConfirm(line.part_id, true)}
                  aria-label={`Confirm ${line.name} is damaged`}
                >
                  <Check /> Damaged
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyPartId !== null}
                  onClick={() => onConfirm(line.part_id, false)}
                  aria-label={`Mark ${line.name} as fine`}
                >
                  <X /> It&rsquo;s fine
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Worth walking over to look at, but not confident enough to order. */
export function CheckList({ lines }: { lines: ReportLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="check-heading">
      <h2 id="check-heading" className="mb-2 text-sm font-medium">
        Worth a look
      </h2>
      <ul className="flex flex-wrap gap-2">
        {lines.map((line) => (
          <li
            key={line.part_id}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
          >
            {line.name}
            <span className="ml-1.5 font-mono tabular-nums">{formatProbability(line.p)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
