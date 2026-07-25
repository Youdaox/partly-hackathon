/**
 * Where a part sits on the car, derived from its name.
 *
 * The dataset has no zone field — a part's `hotspot` places it on an exploded diagram,
 * not on the vehicle — so this reads the part's display name and its diagram's name and
 * maps them onto a position on a side-profile silhouette.
 *
 * Two axes, rather than one long list of rules: a longitudinal hint (front / rear) and a
 * component class (lower body / upper body / wheel / cabin / roof). That covers the
 * collision catalogue with a dozen or so patterns instead of a hundred.
 *
 * Deliberately returns `null` when nothing matches. An unplaced part shows no marker,
 * which is honest; a guessed marker on the wrong corner of the car is not.
 */

export type ZoneId =
  | 'front-lower'
  | 'front-upper'
  | 'front-wheel'
  | 'cabin'
  | 'roof'
  | 'rear-wheel'
  | 'rear-upper'
  | 'rear-lower';

export interface Zone {
  id: ZoneId;
  label: string;
  /** Position on the silhouette, normalised 0..1. The car faces left, so x=0 is the nose. */
  x: number;
  y: number;
}

export const ZONES: Record<ZoneId, Zone> = {
  'front-lower': { id: 'front-lower', label: 'Front, lower', x: 0.1, y: 0.72 },
  'front-upper': { id: 'front-upper', label: 'Front, upper', x: 0.2, y: 0.51 },
  'front-wheel': { id: 'front-wheel', label: 'Front wheel', x: 0.27, y: 0.78 },
  cabin: { id: 'cabin', label: 'Cabin', x: 0.48, y: 0.43 },
  roof: { id: 'roof', label: 'Roof', x: 0.5, y: 0.24 },
  'rear-wheel': { id: 'rear-wheel', label: 'Rear wheel', x: 0.75, y: 0.78 },
  'rear-upper': { id: 'rear-upper', label: 'Rear, upper', x: 0.86, y: 0.47 },
  'rear-lower': { id: 'rear-lower', label: 'Rear, lower', x: 0.92, y: 0.72 },
};

type ComponentClass = 'lower' | 'upper' | 'wheel' | 'cabin' | 'roof';

/** Ordered — the first hit wins, so put the specific patterns above the generic ones. */
const CLASS_PATTERNS: [ComponentClass, RegExp][] = [
  ['roof', /\broof|headlining|sunroof|moonroof/],
  [
    'wheel',
    /\bwheel|tyre|tire|\bhub\b|knuckle|strut|suspension|control arm|\baxle|driveshaft|brake|rotor|caliper|stub/,
  ],
  ['cabin', /\bdoor|mirror|windscreen|windshield|pillar|\bsill\b|quarter glass|\bseat\b|dashboard|\bdash\b/],
  [
    'lower',
    /bumper|grille|absorber|reinforcement|spoiler|valance|apron|splash|undertray|skid|air dam|\bsill plate/,
  ],
  [
    'upper',
    /headlamp|head lamp|headlight|tail lamp|taillight|tail light|\blamps?\b|\blights?\b|bonnet|\bhood\b|tailgate|liftgate|boot lid|trunk lid|deck lid|guard|fender|slam panel|radiator support|cowl|\bbadge|emblem|wiper/,
  ],
];

/** Front and rear zone for each component class. */
const ZONE_BY_CLASS: Record<ComponentClass, { front: ZoneId; rear: ZoneId }> = {
  lower: { front: 'front-lower', rear: 'rear-lower' },
  upper: { front: 'front-upper', rear: 'rear-upper' },
  wheel: { front: 'front-wheel', rear: 'rear-wheel' },
  cabin: { front: 'cabin', rear: 'cabin' },
  roof: { front: 'roof', rear: 'roof' },
};

const REAR_HINT = /\brear\b|\bback\b|tailgate|\bboot\b|trunk|liftgate|\bdeck lid/;
const FRONT_HINT = /\bfront\b|\bfore\b/;

/**
 * Parts that only exist at one end, so they place themselves without the name having to
 * say "front". "Left Headlamp Bracket" never carries the word, and a headlamp is never
 * at the back.
 */
const REAR_ONLY = /tail lamp|taillight|tail light|tailgate|\bboot\b|trunk|liftgate|\bdeck lid/;
const FRONT_ONLY = /headlamp|head lamp|headlight|\bbonnet\b|\bhood\b|grille|radiator|windscreen|windshield/;

/**
 * Resolve a part onto a zone, or `null` if its name gives nothing away.
 *
 * Pass the diagram name too where you have it — "Front Bumper and Bumper Stay" supplies
 * the longitudinal hint that a bare "Cover Retainer" is missing.
 */
export function zoneForPart(displayName: string, diagramName?: string | null): Zone | null {
  const text = `${displayName} ${diagramName ?? ''}`.toLowerCase();

  const matched = CLASS_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (!matched) return null;
  const [componentClass] = matched;

  // Rear is tested first, so a tailgate part is not dragged forward by a stray "front"
  // picked up from a diagram title.
  const end =
    REAR_HINT.test(text) || REAR_ONLY.test(text)
      ? 'rear'
      : FRONT_HINT.test(text) || FRONT_ONLY.test(text)
        ? 'front'
        : null;

  // Wheels and lower/upper bodywork exist at both ends, so an unhinted name is unplaceable.
  if (!end) {
    if (componentClass === 'cabin' || componentClass === 'roof') return ZONES[ZONE_BY_CLASS[componentClass].front];
    return null;
  }

  return ZONES[ZONE_BY_CLASS[componentClass][end]];
}
