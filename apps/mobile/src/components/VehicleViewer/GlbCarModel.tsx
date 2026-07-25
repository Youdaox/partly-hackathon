/**
 * Real GLB loader — not wired up by default (see PlaceholderCarModel for why).
 *
 * Once a real model exists at assets/models/generic-car.glb with meshes named
 * FrontBumper, LeftHeadlight, etc., switch VehicleViewer.tsx to render this instead:
 *
 *   <GlbCarModel source={require('../../../assets/models/generic-car.glb')} ... />
 *
 * Everything downstream (DamageOverlay, mock data, the mesh-name join key) is already
 * written against real mesh names, so nothing else needs to change.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
// Metro resolves the "react-native" package.json field automatically on RN/Expo,
// so this picks up drei's native build without a /native subpath import.
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';

import type { DamageRegion } from '@/types/damage';
import { DamageOverlay } from './DamageOverlay';

interface GlbCarModelProps {
  /** Result of require('...glb') or a remote URI — whatever useGLTF accepts. */
  source: string | number;
  activeRegions: DamageRegion[];
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

interface NamedMeshBounds {
  name: string;
  center: THREE.Vector3;
  size: THREE.Vector3;
}

export function GlbCarModel({
  source,
  activeRegions,
  selectedMeshName,
  onSelectPart,
}: GlbCarModelProps) {
  // drei's native typings lag the loader's actual return shape.
  const gltf = useGLTF(source as never) as unknown as { scene: THREE.Object3D };

  const meshes = useMemo(() => {
    const found: NamedMeshBounds[] = [];
    gltf.scene.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh || !child.name) return;
      const box = new THREE.Box3().setFromObject(child);
      found.push({ name: child.name, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) });
    });
    return found;
  }, [gltf]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const name = event.object.name;
    if (name) onSelectPart(name);
  };

  return (
    <group>
      <primitive object={gltf.scene} onPointerDown={handlePointerDown} />

      {meshes.map((mesh) => {
        const region = activeRegions.find((r) => r.meshName === mesh.name) ?? null;
        if (!region) return null;
        return (
          <DamageOverlay
            key={mesh.name}
            meshName={mesh.name}
            size={[mesh.size.x || 0.2, mesh.size.y || 0.2, mesh.size.z || 0.2]}
            position={[mesh.center.x, mesh.center.y, mesh.center.z]}
            baseColor="#9AA0AC"
            region={region}
            selected={selectedMeshName === mesh.name}
            onSelect={onSelectPart}
            showBase={false}
          />
        );
      })}
    </group>
  );
}

/** World position of a named mesh once the real model is loaded, for camera focus. */
export function getGlbPartWorldPosition(scene: THREE.Object3D, meshName: string): THREE.Vector3 {
  const found = scene.getObjectByName(meshName);
  if (!found) return new THREE.Vector3(0, 0.4, 0);
  return new THREE.Box3().setFromObject(found).getCenter(new THREE.Vector3());
}
