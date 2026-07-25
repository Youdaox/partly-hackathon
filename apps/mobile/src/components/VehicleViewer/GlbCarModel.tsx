/**
 * Real GLB car — assets/models/toyota_gr_corolla.glb, wired up in VehicleViewer.tsx.
 *
 * A detailed Sketchfab model (~170 meshes, CC-BY-4.0, see assets/models/README.md
 * for attribution) but every mesh has a generic exporter-assigned name
 * (`desirefx.me_042`, ...) — real geometry, nothing semantic to match a part name
 * against. So exactly as with the previous placeholder model, the body renders as
 * pure backdrop and PartOverlays (the same hand-placed regions the procedural
 * fallback uses — see carLayout.ts) sits on top of it, positioned from the
 * model's *real* bounding box so they line up with this specific car rather than
 * a generic one.
 *
 * Three corrections make that alignment work, all derived once from the GLB's
 * own node/accessor data (see the long comment above MODEL_RECENTER in
 * carLayout.ts):
 *  - MODEL_SCALE — this file happens to already be in metres, so it's 1, kept
 *    only so a future model swap that *does* need rescaling has somewhere to put it;
 *  - MODEL_ROTATION_Y — the model's native length axis is X, not Z, so the whole
 *    thing is rotated 90° to match this app's +Z-front convention;
 *  - MODEL_RECENTER — the raw geometry isn't centred on the origin.
 *
 * Selection works by picking the body mesh directly rather than raycasting a pile
 * of invisible per-part boxes stacked on top of it: the ~170-mesh body is one
 * real, unambiguous surface, so a tap always resolves to *something* concrete
 * (`event.point`), and nearestExteriorMesh() finds which PART_LAYOUT entry that
 * point is closest to. Doing it the other way — each part owning its own
 * generously-sized invisible hit box — meant adjacent boxes overlapped, and
 * raycasting returns whichever overlapping box is nearest the camera, not
 * whichever one the user was actually looking at.
 */

import { useMemo } from 'react';
import type * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';

import type { DamageRegion } from '@/types/damage';
import { MODEL_RECENTER, MODEL_ROTATION_Y, MODEL_SCALE, nearestExteriorMesh } from './carLayout';
import { PartOverlays } from './PartOverlays';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset require, not a module import
const MODEL_SOURCE = require('../../../assets/models/toyota_gr_corolla.glb') as number;

interface GlbCarModelProps {
  activeRegions: DamageRegion[];
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

export function GlbCarModel({
  activeRegions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
}: GlbCarModelProps) {
  // drei's native typings lag the loader's actual return shape.
  const gltf = useGLTF(MODEL_SOURCE as never) as unknown as { scene: THREE.Object3D };
  const scene = useMemo(() => gltf.scene, [gltf]);

  // Only highlighted parts are clickable, so they are the candidate set the
  // nearest-point search resolves against — see nearestExteriorMesh's note on
  // why restricting it is what makes "nearest" reliable.
  const eligibleMeshNames = useMemo(
    () => activeRegions.map((region) => region.meshName),
    [activeRegions],
  );

  const handleBodyPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const meshName = nearestExteriorMesh(
      [event.point.x, event.point.y, event.point.z],
      eligibleMeshNames,
    );
    if (meshName) onSelectPart(meshName);
  };

  return (
    <group>
      <group scale={MODEL_SCALE} position={MODEL_RECENTER} rotation={[0, MODEL_ROTATION_Y, 0]}>
        <primitive object={scene} onPointerDown={handleBodyPointerDown} />
      </group>

      <PartOverlays
        activeRegions={activeRegions}
        showInvisible={showInvisible}
        selectedMeshName={selectedMeshName}
        onSelectPart={onSelectPart}
        showBase={false}
        drawWheelGeometry={false}
        bodyPickMode
      />
    </group>
  );
}

useGLTF.preload(MODEL_SOURCE as never);
