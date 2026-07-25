/**
 * Approximate part layout for the procedural placeholder car (see PlaceholderCarModel).
 *
 * There is no real geometry to introspect until a GLB lands at
 * assets/models/generic-car.glb, so positions here are hand-placed to roughly resemble
 * a hatchback viewed from the front-left. Swapping to GlbCarModel later replaces this
 * file's role with `mesh.position` read straight off the loaded scene graph.
 */

export interface PartLayout {
  meshName: string;
  /** Box half-extents-free size [width, height, depth]. */
  size: [number, number, number];
  position: [number, number, number];
  /** Neutral (undamaged) color. */
  color: string;
  /** Only rendered opaque when "Invisible Damage" is toggled on. */
  hiddenByDefault?: boolean;
}

export const CAR_BODY_COLOR = '#9AA0AC';

export const PART_LAYOUT: PartLayout[] = [
  { meshName: 'Hood', size: [1.6, 0.12, 1.3], position: [0, 0.55, 1.1], color: CAR_BODY_COLOR },
  {
    meshName: 'FrontBumper',
    size: [1.7, 0.4, 0.3],
    position: [0, 0.25, 2.0],
    color: '#7D828C',
  },
  {
    meshName: 'LeftHeadlight',
    size: [0.35, 0.22, 0.15],
    position: [-0.78, 0.45, 1.9],
    color: '#E8ECF2',
  },
  {
    meshName: 'RightHeadlight',
    size: [0.35, 0.22, 0.15],
    position: [0.78, 0.45, 1.9],
    color: '#E8ECF2',
  },
  {
    meshName: 'LeftFender',
    size: [0.15, 0.6, 1.2],
    position: [-0.85, 0.5, 1.1],
    color: CAR_BODY_COLOR,
  },
  // The impact is front-RIGHT, so the guard that lights up has to be the right
  // one. Mirrors LeftFender across x.
  {
    meshName: 'RightFender',
    size: [0.15, 0.6, 1.2],
    position: [0.85, 0.5, 1.1],
    color: CAR_BODY_COLOR,
  },
  // --- behind the cover, in the order the load travels --------------------
  {
    meshName: 'EnergyAbsorber',
    size: [1.5, 0.25, 0.12],
    position: [0, 0.28, 1.92],
    color: '#6B7280',
    hiddenByDefault: true,
  },
  {
    meshName: 'BumperReinforcement',
    size: [1.5, 0.2, 0.12],
    position: [0, 0.3, 1.82],
    color: '#4A525E',
    hiddenByDefault: true,
  },
  {
    meshName: 'RadiatorSupport',
    size: [1.3, 0.5, 0.15],
    position: [0, 0.5, 1.7],
    color: '#5B6470',
    hiddenByDefault: true,
  },
  // Right-side only: it is the right headlamp that was hit, and this bracket
  // is the part the prediction reaches from it.
  {
    meshName: 'RightHeadlampBracket',
    size: [0.3, 0.16, 0.12],
    position: [0.78, 0.45, 1.74],
    color: '#3F4753',
    hiddenByDefault: true,
  },
  {
    meshName: 'CrashBox',
    size: [0.22, 0.22, 0.35],
    position: [0.62, 0.3, 1.6],
    color: '#39414C',
    hiddenByDefault: true,
  },
];

/** Body shell + cabin + wheels — never damaged, just context for orientation. */
export const STATIC_SHELL: { size: [number, number, number]; position: [number, number, number]; color: string }[] = [
  { size: [1.8, 0.6, 3.6], position: [0, 0.5, 0], color: CAR_BODY_COLOR },
  { size: [1.5, 0.55, 1.6], position: [0, 1.0, -0.3], color: '#6E7480' },
  { size: [1.9, 0.55, 3.7], position: [0, 0.18, 0], color: '#2B2E33' },
];

export function findPartLayout(meshName: string): PartLayout | undefined {
  return PART_LAYOUT.find((part) => part.meshName === meshName);
}
