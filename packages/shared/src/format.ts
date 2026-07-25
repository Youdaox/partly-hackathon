/**
 * Display helpers shared by web and mobile.
 *
 * Option *construction* used to live alongside this (`buildApprovalOptions`). It
 * is gone: the backend builds offers now, because pricing depends on the part's
 * depth and class and the client no longer holds a catalogue.
 *
 * Prices arrive from the API as NZD decimals rather than the minor units the old
 * TypeScript API used, so there is no cents conversion here.
 */

/** `$84.20`. NZD is the only currency the demo deals in. */
export function formatPrice(priceNzd: number, currency = 'NZD'): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(priceNzd);
}

/** `3 days` / `next day`, for a lead time a customer reads. */
export function formatLeadTime(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'next day';
  return `${days} days`;
}

/** `62%` — probabilities are shown as whole percentages everywhere. */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * `Today, 2:14 PM` · `Yesterday` · `Mon` · `12 Jul`.
 *
 * Accepts unix seconds (what the API sends) or anything Date understands.
 */
export function relativeTime(value: number | string | Date): string {
  const then =
    typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(then.getTime())) return '';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) {
    return `Today, ${then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
