/**
 * Damage data model for the AI Damage Inspection Viewer.
 *
 * `meshName` must match a named mesh in `assets/models/generic-car.glb` (or, until
 * that asset lands, a part name in `PlaceholderCarModel`) — that's the only join key
 * between a damage record and something on screen.
 */

export type DamageType = 'visible' | 'invisible';

export interface DamageRegion {
  meshName: string;
  partName: string;
  damageType: DamageType;
  /** 0..1 — drives both the confidence bar and the overlay opacity. */
  confidence: number;
  description: string;
  /** The "AI insight" line shown in the bottom sheet and insight card. */
  explanation: string;
  parts: string[];
}
