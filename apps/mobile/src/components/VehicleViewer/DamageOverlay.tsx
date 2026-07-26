/**
 * Damage + selection highlight layer for one car part.
 *
 * Every part on the car is tappable — this is a locate-a-part tool first, a damage
 * viewer second — so the halo has two modes: a confidence-driven red/orange or
 * blue/purple pulse when a DamageRegion is active, and a plain neutral pulse when
 * the part is merely selected with nothing wrong with it. The pulse runs on R3F's
 * render clock (useFrame), not
 * Reanimated: Reanimated drives native views on the UI thread, it has no hook into
 * three.js material uniforms, which live entirely inside the WebGL/GL context R3F
 * owns. (The 2D chrome around the viewer — toggle glow, bottom sheet, diagram
 * zoom/pan — uses Reanimated instead, where it's the right tool.)
 *
 * The halo is deliberately smaller than the tap region (HALO_FIT) and outlined
 * with crisp Edges rather than rendered as one big inflated box — a box the size
 * of the whole tap target reads as "a giant block," not "this part." It also
 * renders with depthTest off, so it stays visible on top of the (opaque) car body
 * even where the hand-placed region sits slightly inside or behind the real
 * surface — without that, parts of the halo would just disappear depending on
 * which side of the body mesh they landed on.
 *
 * "use no memo": the per-frame material mutation in useFrame is inherently
 * imperative (three.js material uniforms updated every frame outside React's
 * render cycle), which React Compiler's purity analysis can't reason about.
 */
'use no memo';
/* eslint-disable react-hooks/purity --
   Math.random() here only picks a stable per-instance pulse phase once (useMemo,
   empty deps) — not a correctness issue, just outside what the purity rule can verify. */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges, RoundedBox } from '@react-three/drei';

import type { DamageRegion } from '@/types/damage';
import { materialPropsFor, type SurfaceMaterial } from './materials';

const VISIBLE_COLOR = '#FF5A36';
const INVISIBLE_COLOR = '#7C5CFF';
const SELECTION_COLOR = '#4C9AFF';
/** How much smaller the visible halo is than the (generous, invisible) tap region. */
const HALO_FIT = 0.62;

interface DamageOverlayProps {
  meshName: string;
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  baseColor: string;
  region: DamageRegion | null;
  selected: boolean;
  onSelect: (meshName: string) => void;
  /** False when the real geometry is already drawn elsewhere (e.g. a loaded GLTF) and
   * this should render the halo only. */
  showBase?: boolean;
  /**
   * False when selection for this part is resolved elsewhere (GlbCarModel picking
   * the nearest part to a tap on the real body surface) rather than by this part
   * owning its own invisible hit box. Adjacent parts' generous tap boxes overlap by
   * design — good for forgiving taps, bad for precision, since raycasting just
   * returns whichever overlapping box is nearest the camera, not whichever one the
   * user meant. The halo itself still always accepts taps directly; this only
   * controls the invisible full-size box used when `showBase` is false.
   */
  interactive?: boolean;
  /** Corner radius for the base mesh — 0 renders a sharp box (used by the halo either way). */
  radius?: number;
  /** Which real-world surface this part reads as: gloss paint, lamp plastic, dark trim. */
  material?: SurfaceMaterial;
}

export function DamageOverlay({
  meshName,
  size,
  position,
  rotation = [0, 0, 0],
  baseColor,
  region,
  selected,
  onSelect,
  showBase = true,
  interactive = true,
  radius = 0.05,
  material = 'paint',
}: DamageOverlayProps) {
  const haloRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  // Stable per-part phase so parts don't all pulse in lockstep.
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  const showHalo = region !== null || selected;
  const haloSize = useMemo<[number, number, number]>(
    () => [size[0] * HALO_FIT, size[1] * HALO_FIT, size[2] * HALO_FIT],
    [size],
  );

  useFrame((state) => {
    if (!showHalo || !materialRef.current || !haloRef.current) return;

    // No region means "selected but nothing wrong here" — a steady-ish neutral
    // pulse instead of a confidence reading, since there is no confidence.
    const base = region ? THREE.MathUtils.clamp(region.confidence, 0.35, 0.95) : 0.45;
    const amplitude = selected ? 0.22 : 0.15;
    const speed = selected ? 3.2 : 1.8;
    const t = state.clock.elapsedTime * speed + phase;
    const opacity = THREE.MathUtils.clamp(base + amplitude * Math.sin(t), 0.15, 0.98);

    materialRef.current.opacity = opacity;
    materialRef.current.emissiveIntensity = selected ? 1.4 : 0.6 + opacity * 0.4;
    const scale = selected ? 1.14 : 1.08;
    haloRef.current.scale.setScalar(scale);
  });

  const handlePress = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect(meshName);
  };

  // Selected always reads as blue, regardless of what's under it — a repairer
  // tapping around to locate a part needs one consistent "this is the one I
  // picked" colour, not one that keeps changing with whatever region happens
  // to be under their thumb.
  const haloColor = selected
    ? SELECTION_COLOR
    : region?.damageType === 'invisible'
      ? INVISIBLE_COLOR
      : VISIBLE_COLOR;

  return (
    <group position={position} rotation={rotation}>
      {showBase ? (
        <RoundedBox args={size} radius={radius} smoothness={3} onPointerDown={handlePress}>
          <meshPhysicalMaterial color={baseColor} {...materialPropsFor(material)} />
        </RoundedBox>
      ) : interactive ? (
        // No visible base (real GLB body drawn elsewhere) — still needs a tap
        // target, generously sized, or this part could never be selected at all.
        <mesh onPointerDown={handlePress}>
          <boxGeometry args={size} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}

      {showHalo ? (
        <mesh ref={haloRef} onPointerDown={handlePress} renderOrder={10}>
          <boxGeometry args={haloSize} />
          <meshStandardMaterial
            ref={materialRef}
            color={haloColor}
            emissive={haloColor}
            emissiveIntensity={1}
            toneMapped={false}
            transparent
            opacity={region?.confidence ?? 0.45}
            depthWrite={false}
            depthTest={false}
          />
          <Edges color={haloColor} renderOrder={11} />
        </mesh>
      ) : null}
    </group>
  );
}
