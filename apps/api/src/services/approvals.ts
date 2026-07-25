/**
 * Turn a job's damage list into the options a customer chooses between.
 *
 * Hidden damage is only offered once a repairer has confirmed it — an unreviewed
 * guess must never reach the customer as a line item to pay for.
 */

import {
  buildApprovalOptions,
  type ApprovalLineItem,
  type DamageItem,
  type HiddenDamagePrediction,
} from '@first-look/shared';
import { loadAssemblies } from '@first-look/shared/dataset';

export interface BuildLineItemsInput {
  vehicleSlug: string;
  visibleDamage: DamageItem[];
  hiddenDamage: HiddenDamagePrediction[];
}

export function buildLineItems({
  vehicleSlug,
  visibleDamage,
  hiddenDamage,
}: BuildLineItemsInput): ApprovalLineItem[] {
  // The catalogue tells us whether a part is orderable, which decides how many
  // supply options exist. Fall back gracefully for vehicles without a catalogue.
  let assemblies: ReturnType<typeof loadAssemblies>['assemblies'] | null = null;
  try {
    assemblies = loadAssemblies(vehicleSlug).assemblies;
  } catch {
    assemblies = null;
  }

  const isOrderable = (partId: string) => assemblies?.[partId]?.is_orderable ?? true;

  // Confirming a prediction also copies it onto the visible damage list, so without
  // this the part would be quoted as ordinary visible damage and we would lose the
  // "the oracle found this before it was visible" provenance the customer sees.
  const confirmedHiddenPartIds = new Set(
    hiddenDamage.filter((p) => p.confirmed === true).map((p) => p.partId),
  );

  const lineItems: ApprovalLineItem[] = [];
  const seen = new Set<string>();

  for (const item of visibleDamage) {
    if (seen.has(item.partId)) continue;
    seen.add(item.partId);
    lineItems.push({
      partId: item.partId,
      displayName: item.displayName,
      kind: confirmedHiddenPartIds.has(item.partId) ? 'hidden' : 'visible',
      options: buildApprovalOptions({
        partId: item.partId,
        manufacturerPartNumber: item.manufacturerPartNumber,
        isOrderable: isOrderable(item.partId),
      }),
    });
  }

  for (const prediction of hiddenDamage) {
    if (prediction.confirmed !== true) continue;
    if (seen.has(prediction.partId)) continue;
    seen.add(prediction.partId);
    lineItems.push({
      partId: prediction.partId,
      displayName: prediction.displayName,
      kind: 'hidden',
      options: buildApprovalOptions({
        partId: prediction.partId,
        manufacturerPartNumber: assemblies?.[prediction.partId]?.manufacturer_part_number ?? null,
        isOrderable: isOrderable(prediction.partId),
      }),
    });
  }

  return lineItems;
}
