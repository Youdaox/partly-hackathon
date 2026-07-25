/**
 * Shared MeshPhysicalMaterial presets for the procedural car.
 *
 * A handful of tuned roughness/metalness/clearcoat combinations read as real
 * automotive surfaces (gloss paint, lamp plastic, dark trim, chrome) under plain
 * directional lighting — no environment map or texture required. This is most of
 * what separates "a car" from "some boxes" once the geometry itself is rounded.
 */

export type SurfaceMaterial = 'paint' | 'lamp' | 'plastic' | 'chrome' | 'rubber' | 'glass' | 'metal';

interface PhysicalMaterialProps {
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transparent?: boolean;
  opacity?: number;
}

const PRESETS: Record<SurfaceMaterial, PhysicalMaterialProps> = {
  // Gloss automotive paint: a soft base coat under a near-mirror clearcoat layer.
  paint: { roughness: 0.45, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12 },
  // Headlight/taillight lens plastic — brighter highlight, no metal flake.
  lamp: { roughness: 0.15, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  // Grilles, bumper trim, mirror backs — matte, unpainted.
  plastic: { roughness: 0.75, metalness: 0.05 },
  // Wheel rims, badges.
  chrome: { roughness: 0.2, metalness: 0.95 },
  // Tyres.
  rubber: { roughness: 0.95, metalness: 0 },
  // Engine block, exhaust — cast/machined metal, not painted.
  metal: { roughness: 0.5, metalness: 0.75 },
  // Tinted glazing — no true transmission (costly on mobile GL), just dark and glossy.
  glass: {
    roughness: 0.1,
    metalness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.88,
  },
};

export function materialPropsFor(kind: SurfaceMaterial): PhysicalMaterialProps {
  return PRESETS[kind];
}
