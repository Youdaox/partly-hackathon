/**
 * Damage highlight layer for one car part.
 *
 * Renders the part's neutral geometry plus, when a DamageRegion is active for it, a
 * translucent pulsing "halo" on top — red/orange for visible damage, blue/purple for
 * AI-inferred invisible damage. The pulse runs on R3F's render clock (useFrame), not
 * Reanimated: Reanimated drives native views on the UI thread, it has no hook into
 * three.js material uniforms, which live entirely inside the WebGL/GL context R3F
 * owns. (The 2D chrome around the viewer — toggle glow, bottom sheet, diagram
 * zoom/pan — uses Reanimated instead, where it's the right tool.)
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

import type { DamageRegion } from '@/types/damage';

const VISIBLE_COLOR = '#FF5A36';
const INVISIBLE_COLOR = '#7C5CFF';

interface DamageOverlayProps {
  meshName: string;
  size: [number, number, number];
  position: [number, number, number];
  baseColor: string;
  region: DamageRegion | null;
  selected: boolean;
  onSelect: (meshName: string) => void;
  /** False when the real geometry is already drawn elsewhere (e.g. a loaded GLTF) and
   * this should render the halo only. */
  showBase?: boolean;
}

export function DamageOverlay({
  meshName,
  size,
  position,
  baseColor,
  region,
  selected,
  onSelect,
  showBase = true,
}: DamageOverlayProps) {
  const haloRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  // Stable per-part phase so parts don't all pulse in lockstep.
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (!region || !materialRef.current || !haloRef.current) return;

    const base = THREE.MathUtils.clamp(region.confidence, 0.35, 0.95);
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

  const haloColor = region?.damageType === 'invisible' ? INVISIBLE_COLOR : VISIBLE_COLOR;

  return (
    <group position={position}>
      {showBase ? (
        <mesh onPointerDown={handlePress}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={baseColor} roughness={0.6} metalness={0.15} />
        </mesh>
      ) : null}

      {region ? (
        <mesh ref={haloRef} onPointerDown={handlePress}>
          <boxGeometry args={size} />
          <meshStandardMaterial
            ref={materialRef}
            color={haloColor}
            emissive={haloColor}
            transparent
            opacity={region.confidence}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : null}
    </group>
  );
}
