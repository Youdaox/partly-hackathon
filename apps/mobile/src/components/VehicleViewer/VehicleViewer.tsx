/**
 * Interactive 3D vehicle viewer — the centrepiece of the inspection screen.
 *
 * Orchestration only: owns the R3F Canvas, lighting, and the gesture-driven camera
 * rig, and hands the actual geometry off to GlbCarModel (assets/models/generic-car.glb).
 * If that fails to load, swap in PlaceholderCarModel below — same props, procedural
 * geometry instead of the real mesh. Selecting a part re-focuses the camera on it.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';

import type { DamageRegion } from '@/types/damage';
import { CameraRig, useCameraRig } from './CameraController';
import { positionForMesh } from './carLayout';
import { GlbCarModel } from './GlbCarModel';

interface VehicleViewerProps {
  activeRegions: DamageRegion[];
  /** X-ray mode: reveals parts not visible from outside (engine, structural members). */
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

export function VehicleViewer({
  activeRegions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
}: VehicleViewerProps) {
  const { rig, panHandlers, focusOn } = useCameraRig();

  useEffect(() => {
    focusOn(selectedMeshName ? new THREE.Vector3(...positionForMesh(selectedMeshName)) : null);
  }, [selectedMeshName, focusOn]);

  return (
    <View style={{ flex: 1 }} {...panHandlers}>
      <Canvas camera={{ fov: 40 }} gl={{ antialias: true }}>
        <color attach="background" args={['#14161A']} />

        {/* Three-point-ish rig: a strong key light raked across the body to carve out
            the clearcoat highlight, a soft fill so the shadow side isn't dead black,
            and a cool rim light from behind to separate the car from the background. */}
        <ambientLight intensity={0.32} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} castShadow={false} />
        <directionalLight position={[-5, 2, 2]} intensity={0.35} color="#AEB8C8" />
        <directionalLight position={[-2, 3, -5]} intensity={0.6} color="#8FB4FF" />
        <pointLight position={[0, 2.5, 3]} intensity={0.4} distance={6} />

        <CameraRig rig={rig} />

        <GlbCarModel
          activeRegions={activeRegions}
          showInvisible={showInvisible}
          selectedMeshName={selectedMeshName}
          onSelectPart={onSelectPart}
        />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.55} scale={7} blur={2.2} far={2} />
      </Canvas>
    </View>
  );
}
