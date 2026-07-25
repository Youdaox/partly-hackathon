/**
 * Interactive 3D vehicle viewer — the centrepiece of the inspection screen.
 *
 * Orchestration only: owns the R3F Canvas, lighting, and the gesture-driven camera
 * rig, and hands the actual geometry off to PlaceholderCarModel (or GlbCarModel once
 * a real asset exists). Selecting a part re-focuses the camera on it automatically.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import { Canvas } from '@react-three/fiber';

import type { DamageRegion } from '@/types/damage';
import { CameraRig, useCameraRig } from './CameraController';
import { getPartWorldPosition, PlaceholderCarModel } from './PlaceholderCarModel';

interface VehicleViewerProps {
  activeRegions: DamageRegion[];
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}

export function VehicleViewer({ activeRegions, selectedMeshName, onSelectPart }: VehicleViewerProps) {
  const { rig, panHandlers, focusOn } = useCameraRig();

  useEffect(() => {
    focusOn(selectedMeshName ? getPartWorldPosition(selectedMeshName) : null);
  }, [selectedMeshName, focusOn]);

  return (
    <View style={{ flex: 1 }} {...panHandlers}>
      <Canvas camera={{ fov: 40 }} gl={{ antialias: true }}>
        <color attach="background" args={['#14161A']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <directionalLight position={[-4, 3, -3]} intensity={0.35} />

        <CameraRig rig={rig} />

        <PlaceholderCarModel
          activeRegions={activeRegions}
          selectedMeshName={selectedMeshName}
          onSelectPart={onSelectPart}
        />
      </Canvas>
    </View>
  );
}
