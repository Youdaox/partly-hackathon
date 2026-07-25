/**
 * Procedural stand-in for assets/models/generic-car.glb.
 *
 * Only used if the real model fails to load — see VehicleViewer.tsx. Renders the
 * same shell + PartOverlays as the real model, just with plain rounded boxes
 * standing in for the body instead of the loaded mesh, so the whole feature
 * (locate any part, toggle damage, pulse, camera focus, bottom sheet) keeps
 * working even without a working GLB. Every other component only cares about
 * mesh *names*, not how they're drawn.
 */

import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';

import type { DamageRegion } from '@/types/damage';
import { materialPropsFor } from './materials';
import { PartOverlays } from './PartOverlays';
import { positionForMesh, STATIC_SHELL } from './carLayout';

interface PlaceholderCarModelProps {
  activeRegions: DamageRegion[];
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

export function PlaceholderCarModel({
  activeRegions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
}: PlaceholderCarModelProps) {
  return (
    <group>
      {STATIC_SHELL.map((piece, index) => (
        <RoundedBox
          key={index}
          args={piece.size}
          radius={piece.radius ?? 0.02}
          smoothness={3}
          position={piece.position}
          rotation={piece.rotation ?? [0, 0, 0]}
        >
          <meshPhysicalMaterial color={piece.color} {...materialPropsFor(piece.material)} />
        </RoundedBox>
      ))}

      <PartOverlays
        activeRegions={activeRegions}
        showInvisible={showInvisible}
        selectedMeshName={selectedMeshName}
        onSelectPart={onSelectPart}
        showBase
        drawWheelGeometry
        bodyPickMode={false}
      />
    </group>
  );
}

/** World position of any locatable part, for the camera to focus on. */
export function getPartWorldPosition(meshName: string): THREE.Vector3 {
  return new THREE.Vector3(...positionForMesh(meshName));
}
