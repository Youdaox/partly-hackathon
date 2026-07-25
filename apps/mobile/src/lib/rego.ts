/**
 * Turn one typed sentence into a rego plus the damage description.
 *
 * The backend registers vehicles by rego, but the mockup's entry screen is a single free
 * prompt, and a repairer is as likely to say "yaris" as "QMN16". So accept either: a rego
 * token if one is present, otherwise a make/model match against the fleet.
 *
 * `matchVehicle` from the shared package does the name half — it already handles squashed
 * slugs, missing hyphens and the registration fragment inside a slug, and is tested.
 */

import { matchVehicle, type VehicleSummary } from '@partli/shared';

import type { VehicleListItem } from '@/lib/backend';

export interface RegoMatch {
  rego: string;
  /** Everything that was not the vehicle, i.e. the damage description. */
  remainder: string;
  vehicle: VehicleListItem;
}

/** Adapt the backend's list shape onto the one `matchVehicle` expects.

    @partli/shared moved to the wire's snake_case during the /v1 rewrite, so
    this is now field-for-field — kept as a seam in case the shapes drift. */
function asSummary(item: VehicleListItem): VehicleSummary {
  return {
    slug: item.slug,
    rego: item.rego,
    make: item.make,
    model: item.model,
    year: item.year,
    has_catalogue: item.has_catalogue,
    has_prediction: item.has_prediction,
  };
}

/**
 * Resolve a sentence onto a vehicle.
 *
 * A spelled-out rego wins over a name, because it is unambiguous — "QMN16" identifies one
 * car, while "toyota" could be three.
 */
export function resolveRego(text: string, vehicles: VehicleListItem[]): RegoMatch | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Rego first. Compare on letters and digits only, so "qmn 16" and "QMN16" both land.
  const squash = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const word of trimmed.split(/\s+/)) {
    const candidate = squash(word);
    if (!candidate) continue;
    const hit = vehicles.find((v) => squash(v.rego) === candidate);
    if (hit) {
      const remainder = trimmed
        .split(/\s+/)
        .filter((w) => squash(w) !== candidate)
        .join(' ')
        .trim();
      return { rego: hit.rego, remainder, vehicle: hit };
    }
  }

  // Then the make/model path, restricted to vehicles that have a catalogue — a
  // prediction alone cannot produce part-level output.
  const startable = vehicles.filter((v) => v.has_catalogue);
  const named = matchVehicle(trimmed, startable.map(asSummary), { requireCatalogue: true });
  if (!named) return null;

  const vehicle = startable.find((v) => v.slug === named.vehicle.slug);
  if (!vehicle) return null;

  return { rego: vehicle.rego, remainder: named.remainder, vehicle };
}
