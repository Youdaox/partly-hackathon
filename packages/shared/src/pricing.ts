/**
 * Placeholder pricing for the customer approval page.
 *
 * MVP ONLY — there is no pricing data in the hackathon dataset, so we derive stable
 * pseudo-prices from the part id. Deterministic (same part always quotes the same
 * price) so demos don't flicker between reloads. Swap this whole module out when
 * real supplier pricing arrives; nothing else depends on how the numbers are made.
 */

import type { ApprovalOption, PartTier } from './types.js';

/** Stable 32-bit hash so a given part always yields the same price. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

interface TierSpec {
  tier: PartTier;
  label: string;
  /** Multiplier applied to the OEM base price. */
  priceFactor: number;
  etaDays: number;
  warranty: string;
}

const TIERS: TierSpec[] = [
  { tier: 'oem', label: 'Genuine (OEM)', priceFactor: 1, etaDays: 5, warranty: '24 months' },
  {
    tier: 'aftermarket',
    label: 'Aftermarket',
    priceFactor: 0.62,
    etaDays: 2,
    warranty: '12 months',
  },
  { tier: 'used', label: 'Used / Recycled', priceFactor: 0.38, etaDays: 7, warranty: '3 months' },
];

export interface BuildOptionsInput {
  partId: string;
  manufacturerPartNumber: string | null;
  isOrderable: boolean;
  currency?: string;
}

/**
 * Build the 2-3 supply options shown per damaged part. Non-orderable parts only get
 * the OEM option, since there is no aftermarket equivalent to quote.
 */
export function buildApprovalOptions({
  partId,
  manufacturerPartNumber,
  isOrderable,
  currency = 'NZD',
}: BuildOptionsInput): ApprovalOption[] {
  // Base price between $80 and $980, stable per part.
  const basePriceCents = (80 + (hash(partId) % 900)) * 100;
  const tiers = isOrderable ? TIERS : TIERS.slice(0, 1);

  return tiers.map((spec) => ({
    id: `${partId}:${spec.tier}`,
    tier: spec.tier,
    label: spec.label,
    priceCents: Math.round((basePriceCents * spec.priceFactor) / 100) * 100,
    currency,
    etaDays: spec.etaDays,
    warranty: spec.warranty,
    manufacturerPartNumber,
    isOrderable,
  }));
}

export function formatPrice(priceCents: number, currency = 'NZD'): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(priceCents / 100);
}
