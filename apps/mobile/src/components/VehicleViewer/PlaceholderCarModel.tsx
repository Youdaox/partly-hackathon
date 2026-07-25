/**
 * Procedural stand-in for assets/models/generic-car.glb.
 *
 * No real GLB ships in this repo yet, and `require()`-ing one that doesn't exist
 * breaks the Metro bundle for everyone, not just at runtime. This renders the same
 * named parts (FrontBumper, LeftHeadlight, ...) as plain boxes so the whole feature —
 * toggle, selection, pulsing, camera focus, bottom sheet — is demoable today. Once a
 * real model lands, swap <PlaceholderCarModel> for <GlbCarModel> in VehicleViewer.tsx;
 * every other component only cares about mesh *names*, not how they're drawn.
 */

import * as THREE from 'three';

import type { DamageRegion } from '@/types/damage';
import { DamageOverlay } from './DamageOverlay';
import { PART_LAYOUT, STATIC_SHELL } from './carLayout';

interface PlaceholderCarModelProps {
  activeRegions: DamageRegion[];
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

export function PlaceholderCarModel({
  activeRegions,
  selectedMeshName,
  onSelectPart,
}: PlaceholderCarModelProps) {
  return (
    <group>
      {STATIC_SHELL.map((piece, index) => (
        <mesh key={index} position={piece.position}>
          <boxGeometry args={piece.size} />
          <meshStandardMaterial color={piece.color} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}

      {PART_LAYOUT.map((part) => {
        const region = activeRegions.find((r) => r.meshName === part.meshName) ?? null;

        // Internal-only components (crash bar, radiator support, sensors) have no
        // reason to render when nothing is flagging them — there's nothing to see.
        if (part.hiddenByDefault && !region) return null;

        return (
          <DamageOverlay
            key={part.meshName}
            meshName={part.meshName}
            size={part.size}
            position={part.position}
            baseColor={part.color}
            region={region}
            selected={selectedMeshName === part.meshName}
            onSelect={onSelectPart}
          />
        );
      })}
    </group>
  );
}

/** World position of a part, for the camera to focus on. Falls back to car centre. */
export function getPartWorldPosition(meshName: string): THREE.Vector3 {
  const part = PART_LAYOUT.find((p) => p.meshName === meshName);
  return part ? new THREE.Vector3(...part.position) : new THREE.Vector3(0, 0.4, 0);
}
