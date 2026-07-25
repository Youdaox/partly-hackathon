/**
 * @partli/shared/dataset — Node-only dataset access.
 *
 * Reads the repo's `data/` folder. Import this from apps/api and from scripts, never
 * from mobile or web (it depends on `node:fs`).
 */

export * from './raw.js';
export * from './paths.js';
export * from './load.js';
export * from './proximity.js';

import type { ProximityGraph, VehicleSlug } from '../types.js';
import { loadAssemblies } from './load.js';
import { buildProximityGraphForSlug, type BuildGraphOptions } from './proximity.js';

/**
 * The headline helper: proximity graph for a vehicle slug, loaded from disk and
 * cached per process. Building the Yaris graph walks 7k parts, so let the cache work.
 */
export function proximityGraph(
  slug: VehicleSlug,
  options?: BuildGraphOptions,
): ProximityGraph {
  return buildProximityGraphForSlug(slug, loadAssemblies, options);
}
