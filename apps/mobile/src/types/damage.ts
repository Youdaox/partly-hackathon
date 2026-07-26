/**
 * Damage data model for the AI Damage Inspection Viewer.
 *
 * `meshName` must match a named mesh in `assets/models/generic-car.glb` (or, until
 * that asset lands, a part name in `PlaceholderCarModel`) — that's the only join key
 * between a damage record and something on screen.
 *
 * A region is built from the real case report (see `lib/damage-regions.ts`), not
 * invented: one region groups every real catalogue part that mapped onto the same
 * mesh, so tapping a highlighted area opens the actual parts behind it rather than
 * a canned description.
 */

import type { Bucket } from '@partli/shared';

export type DamageType = 'visible' | 'invisible';

/** One real catalogue part folded into a region — a row in the bottom sheet's parts list. */
export interface RegionPart {
  partId: string;
  name: string;
  qty: number;
  /** Which report section this came from. A `visible` part is a stated fact; the rest are predictions. */
  bucket: Bucket;
  /** 0..1 — only meaningful for `order`/`check`; see `ReportLine.p`. */
  p: number;
  reason?: string;
  /** null = not yet inspected (only set for `check` parts). */
  confirmed?: boolean | null;
  diagramId?: string;
  /** False when the diagram exists but ships no image — do not fetch it. */
  diagramAvailable?: boolean;
}

export interface DamageRegion {
  meshName: string;
  partName: string;
  damageType: DamageType;
  /** 0..1 — drives both the confidence bar and the overlay opacity. */
  confidence: number;
  /** One-line summary for the region-level views (the damage summary sheet). */
  description: string;
  /** Every real part that mapped onto this mesh, strongest first. */
  parts: RegionPart[];
}
