/**
 * Orbit camera for the 3D viewer: one-finger drag to orbit, two-finger pinch to zoom,
 * and a `focusOn` escape hatch that smoothly animates the camera toward a selected part.
 *
 * Split in two because a plain RN gesture responder has to live outside <Canvas> (it
 * needs a native View), while the per-frame camera math has to live inside it (it
 * needs R3F's useThree/useFrame). `useCameraRig` returns a ref both sides share, so
 * gestures write into it and `CameraRig` reads it every frame — no context, no store.
 *
 * "use no memo": this is intentionally imperative — a ref mutated by gestures and read
 * every animation frame outside React's render cycle, which is how R3F camera rigs and
 * RN gesture responders work. React Compiler's purity rules don't model that; PanResponder
 * and useFrame both need this file left uncompiled.
 */
'use no memo';
/* eslint-disable react-hooks/refs, react-hooks/immutability --
   same reason as the "use no memo" pragma above: a shared ref, mutated by gestures and
   read every animation frame, is the whole point of this file. */

import { useCallback, useRef } from 'react';
import { PanResponder } from 'react-native';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

export interface CameraRigState {
  azimuth: number;
  polar: number;
  radius: number;
  targetRadius: number;
  focus: THREE.Vector3;
  targetFocus: THREE.Vector3;
}

const DEFAULT_FOCUS = new THREE.Vector3(0, 0.4, 0);
const DEFAULT_RADIUS = 6;
const FOCUSED_RADIUS = 3.2;

export function useCameraRig() {
  const rig = useRef<CameraRigState>({
    azimuth: Math.PI / 4,
    polar: Math.PI / 2.6,
    radius: DEFAULT_RADIUS,
    targetRadius: DEFAULT_RADIUS,
    focus: DEFAULT_FOCUS.clone(),
    targetFocus: DEFAULT_FOCUS.clone(),
  });

  const lastPan = useRef({ dx: 0, dy: 0 });
  const lastPinchDistance = useRef<number | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lastPan.current = { dx: 0, dy: 0 };
        lastPinchDistance.current = null;
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          const [a, b] = touches;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (lastPinchDistance.current != null) {
            const delta = distance - lastPinchDistance.current;
            rig.current.targetRadius = THREE.MathUtils.clamp(
              rig.current.targetRadius - delta * 0.02,
              2.2,
              10,
            );
          }
          lastPinchDistance.current = distance;
          return;
        }
        lastPinchDistance.current = null;

        const deltaX = gestureState.dx - lastPan.current.dx;
        const deltaY = gestureState.dy - lastPan.current.dy;
        lastPan.current = { dx: gestureState.dx, dy: gestureState.dy };

        rig.current.azimuth -= deltaX * 0.008;
        rig.current.polar = THREE.MathUtils.clamp(
          rig.current.polar - deltaY * 0.008,
          0.5,
          1.5,
        );
      },
      onPanResponderRelease: () => {
        lastPinchDistance.current = null;
      },
    }),
  ).current;

  /** Animate toward a part's world position, or pass null to return to the full car. */
  const focusOn = useCallback((position: THREE.Vector3 | null) => {
    if (position) {
      rig.current.targetFocus.copy(position);
      rig.current.targetRadius = FOCUSED_RADIUS;
    } else {
      rig.current.targetFocus.copy(DEFAULT_FOCUS);
      rig.current.targetRadius = DEFAULT_RADIUS;
    }
  }, []);

  return { rig, panHandlers: panResponder.panHandlers, focusOn };
}

/** Lives inside <Canvas>. Reads the rig ref every frame and drives the real camera. */
export function CameraRig({ rig }: { rig: React.RefObject<CameraRigState> }) {
  const { camera } = useThree();

  useFrame(() => {
    const state = rig.current;
    state.radius = THREE.MathUtils.lerp(state.radius, state.targetRadius, 0.08);
    state.focus.lerp(state.targetFocus, 0.08);

    camera.position.set(
      state.focus.x + state.radius * Math.sin(state.polar) * Math.sin(state.azimuth),
      state.focus.y + state.radius * Math.cos(state.polar),
      state.focus.z + state.radius * Math.sin(state.polar) * Math.cos(state.azimuth),
    );
    camera.lookAt(state.focus);
  });

  return null;
}
