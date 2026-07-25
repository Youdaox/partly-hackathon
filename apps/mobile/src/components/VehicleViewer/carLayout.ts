/**
 * Layout for the car in the 3D viewer — both the procedural placeholder
 * (PlaceholderCarModel) and the hand-placed overlays on top of the real model
 * (GlbCarModel, assets/models/toyota_gr_corolla.glb).
 *
 * The point of this screen is a repairer locating and identifying parts on a
 * vehicle, not a photoreal render of one specific model — so this covers the main
 * components a repairer actually thinks in (engine, windscreen, doors, bumpers,
 * lights, trunk, wheels...) not an exhaustive parts-catalogue replica (no
 * interior, no fasteners, no wiring).
 *
 * The Corolla GLB ships as ~170 meshes with generic exporter-assigned names
 * (`desirefx.me_042`, ...) — real geometry, but nothing semantic to match a part
 * name against. So exactly as with the previous model, every part below is a
 * hand-placed, invisible tap/halo region overlaid on top of the real body,
 * positioned using the model's *actual* world-space bounding box — computed by
 * composing all 336 nodes' transform matrices (this file bakes per-mesh matrices
 * rather than using simple TRS, so a naive "sum the accessor min/max" gives
 * garbage; see the extraction note below MODEL_RECENTER):
 *
 *   length (Z) 4.40, width (X) 2.06, height (Y) 0 → 1.48, +Z = front, +X = left
 *
 * A front-engine 5-door hatchback, so — unlike the previous mid-engine 2-door
 * model — this restores rear doors and puts the engine back under the hood.
 */

import type { SurfaceMaterial } from './materials';

export interface PartLayout {
  meshName: string;
  /** Human-readable name shown in the UI, independent of whether it's damaged. */
  label: string;
  /** Rounded-box size [width, height, depth] — used by the procedural fallback,
   * and as the tap/halo region size when overlaid on the real model. */
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Corner radius, scaled to the part's smallest dimension (procedural fallback only). */
  radius?: number;
  /** Neutral (undamaged) color — procedural fallback only; the real model has its
   * own baked materials, so this is unused by GlbCarModel. */
  color: string;
  material: SurfaceMaterial;
  /**
   * Not visible from outside the car (engine bay contents, structural members,
   * sensors). Rendered only while the "Invisible Damage" toggle is on — that
   * toggle doubles as an X-ray / cutaway mode for locating what's underneath,
   * not just a damage filter. This is the "highlight internal parts when
   * identified" behaviour: DamageOverlay pulses these in blue/purple when a
   * DamageRegion names them, and shows them dim and neutral otherwise so they
   * can still be located with nothing wrong.
   */
  hidden?: boolean;
}

export const CAR_BODY_COLOR = '#C7311F';
const CABIN_COLOR = '#B02A1B';
const HEADLIGHT_COLOR = '#EEF3FA';
const GLASS_COLOR = '#1B2530';
const DARK_TRIM = '#2A2E35';

/**
 * toyota_gr_corolla.glb's raw geometry is already in metres (no MODEL_SCALE
 * needed — kept at 1 so the constant stays meaningful for a future model swap
 * that *does* need rescaling), but it is not centred on the origin, and its own
 * axes don't match this file's +Z-front/+X-left convention (natively the car's
 * length runs along X and width along Z).
 *
 * Both numbers below were computed once, offline, from the GLB's own node
 * matrices and accessor bounds (336 nodes, most carrying a baked transform
 * matrix rather than plain translation — composing all of them is what the true
 * bounding box needs; summing raw accessor min/max across meshes without doing
 * that gives a nonsense ~2000-unit-tall "car"). The recentred, native-axis
 * bounding box came out to X∈[0.16,4.56] (length), Y∈[0.01,1.49] (height),
 * Z∈[4.63,6.69] (width) — GlbCarModel's wrapping group rotates 90° around Y to
 * swap length onto Z and width onto X, then MODEL_RECENTER shifts the result
 * so the car sits centred at the origin with its wheels on Y=0.
 *
 * Caveat: which end of the model is the front, and which side is left, was not
 * visually confirmed (no way to render from here) — only the overall proportions
 * are certain. If the car looks mirrored or back-to-front once someone actually
 * looks at it, negate MODEL_ROTATION_Y (front/back) or mirror the X sign in
 * PART_LAYOUT/WHEEL_LAYOUT below (left/right) rather than re-deriving anything.
 */
export const MODEL_SCALE = 1;
export const MODEL_ROTATION_Y = Math.PI / 2;
export const MODEL_RECENTER: [number, number, number] = [-5.663, -0.006, 2.363];

export const PART_LAYOUT: PartLayout[] = [
  // --- front -----------------------------------------------------------------
  {
    meshName: 'FrontBumper',
    label: 'Front bumper',
    size: [1.85, 0.35, 0.3],
    position: [0, 0.3, 2.05],
    radius: 0.12,
    color: '#9A2A1D',
    material: 'paint',
  },
  {
    meshName: 'Hood',
    label: 'Hood',
    size: [1.3, 0.14, 0.9],
    position: [0, 0.68, 1.5],
    radius: 0.05,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'LeftHeadlight',
    label: 'Left headlight',
    size: [0.3, 0.15, 0.2],
    position: [0.65, 0.5, 1.9],
    radius: 0.04,
    color: HEADLIGHT_COLOR,
    material: 'lamp',
  },
  {
    meshName: 'RightHeadlight',
    label: 'Right headlight',
    size: [0.3, 0.15, 0.2],
    position: [-0.65, 0.5, 1.9],
    radius: 0.04,
    color: HEADLIGHT_COLOR,
    material: 'lamp',
  },
  {
    meshName: 'LeftFender',
    label: 'Left front fender',
    size: [0.14, 0.5, 0.9],
    position: [0.95, 0.55, 1.1],
    radius: 0.06,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'RightFender',
    label: 'Right front fender',
    size: [0.14, 0.5, 0.9],
    position: [-0.95, 0.55, 1.1],
    radius: 0.06,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },

  // --- cabin -------------------------------------------------------------------
  {
    meshName: 'Windscreen',
    label: 'Windscreen',
    size: [1.1, 0.4, 0.06],
    position: [0, 0.95, 0.5],
    rotation: [-0.6, 0, 0],
    color: GLASS_COLOR,
    material: 'glass',
  },
  {
    meshName: 'Roof',
    label: 'Roof panel',
    size: [1.0, 0.1, 1.1],
    position: [0, 1.35, -0.15],
    radius: 0.1,
    color: CABIN_COLOR,
    material: 'paint',
  },
  {
    meshName: 'LeftFrontDoor',
    label: 'Left front door',
    size: [0.1, 0.5, 0.85],
    position: [1.0, 0.65, 0.1],
    radius: 0.05,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'RightFrontDoor',
    label: 'Right front door',
    size: [0.1, 0.5, 0.85],
    position: [-1.0, 0.65, 0.1],
    radius: 0.05,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'LeftRearDoor',
    label: 'Left rear door',
    size: [0.1, 0.5, 0.75],
    position: [1.0, 0.65, -0.75],
    radius: 0.05,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'RightRearDoor',
    label: 'Right rear door',
    size: [0.1, 0.5, 0.75],
    position: [-1.0, 0.65, -0.75],
    radius: 0.05,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },

  // --- rear ----------------------------------------------------------------
  {
    meshName: 'Trunk',
    label: 'Hatch',
    size: [1.1, 0.35, 0.85],
    position: [0, 0.85, -1.55],
    radius: 0.1,
    color: CAR_BODY_COLOR,
    material: 'paint',
  },
  {
    meshName: 'RearBumper',
    label: 'Rear bumper',
    size: [1.8, 0.35, 0.3],
    position: [0, 0.3, -2.05],
    radius: 0.1,
    color: '#3A3E45',
    material: 'plastic',
  },
  {
    meshName: 'LeftTaillight',
    label: 'Left taillight',
    size: [0.28, 0.15, 0.18],
    position: [0.65, 0.55, -1.95],
    color: '#C0392B',
    material: 'lamp',
  },
  {
    meshName: 'RightTaillight',
    label: 'Right taillight',
    size: [0.28, 0.15, 0.18],
    position: [-0.65, 0.55, -1.95],
    color: '#C0392B',
    material: 'lamp',
  },
  {
    meshName: 'Exhaust',
    label: 'Exhaust',
    size: [0.16, 0.14, 0.3],
    position: [0.35, 0.2, -2.15],
    radius: 0.05,
    color: '#8A8F97',
    material: 'metal',
  },

  // --- hidden / internal — only shown in X-ray mode -------------------------
  {
    // Front-engine layout: under the hood, ahead of the cabin.
    meshName: 'Engine',
    label: 'Engine',
    size: [1.0, 0.4, 0.8],
    position: [0, 0.55, 1.35],
    radius: 0.06,
    color: '#3B3F45',
    material: 'metal',
    hidden: true,
  },
  {
    meshName: 'RadiatorSupport',
    label: 'Radiator support',
    size: [1.2, 0.4, 0.15],
    position: [0, 0.5, 1.9],
    color: '#5B6470',
    material: 'plastic',
    hidden: true,
  },
  {
    meshName: 'CrashBar',
    label: 'Crash reinforcement bar',
    size: [1.4, 0.18, 0.12],
    position: [0, 0.32, 1.98],
    color: '#4A525E',
    material: 'chrome',
    hidden: true,
  },
  {
    meshName: 'Sensors',
    label: 'Parking sensors',
    size: [0.12, 0.08, 0.08],
    position: [0, 0.32, 2.1],
    color: '#2E333B',
    material: 'plastic',
    hidden: true,
  },
];

export interface ShellPiece {
  size: [number, number, number];
  position: [number, number, number];
  radius?: number;
  rotation?: [number, number, number];
  color: string;
  material: SurfaceMaterial;
}

/**
 * Pure backdrop for the *procedural* fallback only — the low body "tub" doors and
 * fenders sit on, the grille and the mirrors. Never tappable, never damaged, and
 * never rendered by GlbCarModel (the real body mesh replaces all of it).
 */
export const STATIC_SHELL: ShellPiece[] = [
  { size: [1.8, 0.34, 4.0], position: [0, 0.28, 0], radius: 0.16, color: CAR_BODY_COLOR, material: 'paint' },
  { size: [0.9, 0.22, 0.06], position: [0, 0.4, 2.18], color: DARK_TRIM, material: 'plastic' },
  { size: [0.12, 0.1, 0.2], position: [-1.05, 0.95, 0.5], color: CAR_BODY_COLOR, material: 'paint' },
  { size: [0.12, 0.1, 0.2], position: [1.05, 0.95, 0.5], color: CAR_BODY_COLOR, material: 'paint' },
];

export interface WheelLayout {
  meshName: string;
  label: string;
  position: [number, number, number];
  radius: number;
  width: number;
}

/**
 * Front-left, front-right, rear-left, rear-right. Unlike the body panels above,
 * the Corolla GLB's own wheel meshes weren't individually isolated from its ~170
 * anonymous meshes in the time available, so these are estimated from typical
 * hatchback axle placement against the real body length/width rather than read
 * off the model directly — worth true-ing up against the actual wheel arches
 * once someone can see the render.
 */
export const WHEEL_LAYOUT: WheelLayout[] = [
  { meshName: 'LeftFrontWheel', label: 'Left front wheel', position: [0.9, 0.33, 1.35], radius: 0.33, width: 0.24 },
  { meshName: 'RightFrontWheel', label: 'Right front wheel', position: [-0.9, 0.33, 1.35], radius: 0.33, width: 0.24 },
  { meshName: 'LeftRearWheel', label: 'Left rear wheel', position: [0.9, 0.33, -1.3], radius: 0.33, width: 0.24 },
  { meshName: 'RightRearWheel', label: 'Right rear wheel', position: [-0.9, 0.33, -1.3], radius: 0.33, width: 0.24 },
];

export function findPartLayout(meshName: string): PartLayout | undefined {
  return PART_LAYOUT.find((part) => part.meshName === meshName);
}

export function findWheelLayout(meshName: string): WheelLayout | undefined {
  return WHEEL_LAYOUT.find((wheel) => wheel.meshName === meshName);
}

/** Display label for any locatable mesh, part or wheel. Falls back to the raw name. */
export function labelForMesh(meshName: string): string {
  return findPartLayout(meshName)?.label ?? findWheelLayout(meshName)?.label ?? meshName;
}

/** World position of any locatable mesh, for the camera to focus on. */
export function positionForMesh(meshName: string): [number, number, number] {
  const part = findPartLayout(meshName);
  if (part) return part.position;
  const wheel = findWheelLayout(meshName);
  if (wheel) return wheel.position;
  return [0, 0.4, 0];
}

function distanceSquared(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Which *eligible* exterior part is closest to a 3D point — used to resolve a tap
 * on the real GLB body's surface to a specific part. GlbCarModel picks the body
 * mesh directly (one real, unambiguous surface) rather than raycasting a pile of
 * overlapping invisible per-part hit boxes, then asks this which of
 * `eligibleMeshNames` the hit point landed nearest to. Hidden/internal parts are
 * excluded outright — a tap on the outer surface should never resolve to
 * something inside the car — and `eligibleMeshNames` is normally just the
 * currently-highlighted parts, since only highlighted parts are clickable at all
 * (see DamageOverlay). Restricting the candidate set this way is also what makes
 * the nearest-point search reliable: with only a handful of highlighted parts in
 * play at once, "nearest" rarely has to break a close tie between neighbours.
 */
export function nearestExteriorMesh(
  point: [number, number, number],
  eligibleMeshNames: readonly string[],
): string | null {
  const eligible = new Set(eligibleMeshNames);
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const part of PART_LAYOUT) {
    if (part.hidden || !eligible.has(part.meshName)) continue;
    const d = distanceSquared(point, part.position);
    if (d < bestDistance) {
      bestDistance = d;
      best = part.meshName;
    }
  }

  for (const wheel of WHEEL_LAYOUT) {
    if (!eligible.has(wheel.meshName)) continue;
    const d = distanceSquared(point, wheel.position);
    if (d < bestDistance) {
      bestDistance = d;
      best = wheel.meshName;
    }
  }

  return best;
}
