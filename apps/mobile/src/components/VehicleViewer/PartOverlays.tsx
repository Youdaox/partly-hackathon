/**
 * The tap/halo regions for every locatable part and wheel, shared between
 * PlaceholderCarModel (where they're also the visible geometry) and GlbCarModel
 * (where they're invisible regions floating over the real body mesh). Keeping this
 * in one place means the interaction model — what's tappable, what X-ray reveals,
 * how selection and damage halos render — can't drift between the two.
 */

import { Cylinder, Torus } from '@react-three/drei';

import type { DamageRegion } from '@/types/damage';
import { DamageOverlay } from './DamageOverlay';
import { materialPropsFor } from './materials';
import { PART_LAYOUT, WHEEL_LAYOUT } from './carLayout';

interface PartOverlaysProps {
  activeRegions: DamageRegion[];
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
  /** True on the procedural fallback (the overlay IS the visible part). False over
   * a real loaded model, where only the halo should render. */
  showBase: boolean;
  /** Draw the wheel tyre/rim geometry too — only the procedural fallback needs
   * this; the real model ships its own wheel meshes. */
  drawWheelGeometry: boolean;
  /**
   * True on GlbCarModel: exterior parts skip their own invisible hit box, since
   * GlbCarModel resolves taps by picking the real body surface and finding the
   * nearest part instead — overlapping per-part boxes made it easy to select the
   * wrong (nearer-to-camera) neighbour. Hidden/internal parts and wheels keep
   * their own hit box regardless, since they aren't part of that body surface.
   */
  bodyPickMode: boolean;
}

export function PartOverlays({
  activeRegions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
  showBase,
  drawWheelGeometry,
  bodyPickMode,
}: PartOverlaysProps) {
  return (
    <group>
      {WHEEL_LAYOUT.map((wheel) => {
        // Tyre axis needs to run along world X (left-right axle). CylinderGeometry's
        // axis defaults to Y, so roll it 90° around Z. A torus's hole-axis defaults to
        // Z, so it needs a 90° turn around Y instead to face the same way — rotating
        // both "the same amount" would leave them perpendicular to each other, not
        // aligned, since they start from different default orientations.
        const rimOffset = wheel.width / 2 + 0.001;
        const region = activeRegions.find((r) => r.meshName === wheel.meshName) ?? null;
        return (
          <group key={wheel.meshName} position={wheel.position}>
            {drawWheelGeometry ? (
              <>
                <Cylinder args={[wheel.radius, wheel.radius, wheel.width, 20]} rotation={[0, 0, Math.PI / 2]}>
                  <meshPhysicalMaterial color="#1A1A1D" {...materialPropsFor('rubber')} />
                </Cylinder>
                <Torus
                  args={[wheel.radius * 0.55, wheel.radius * 0.14, 12, 20]}
                  position={[rimOffset, 0, 0]}
                  rotation={[0, Math.PI / 2, 0]}
                >
                  <meshPhysicalMaterial color="#C9CCD1" {...materialPropsFor('chrome')} />
                </Torus>
                <Torus
                  args={[wheel.radius * 0.55, wheel.radius * 0.14, 12, 20]}
                  position={[-rimOffset, 0, 0]}
                  rotation={[0, Math.PI / 2, 0]}
                >
                  <meshPhysicalMaterial color="#C9CCD1" {...materialPropsFor('chrome')} />
                </Torus>
              </>
            ) : null}

            {/* Tap target + damage/selection halo, sized around the tyre. */}
            <DamageOverlay
              meshName={wheel.meshName}
              size={[wheel.width + 0.05, wheel.radius * 2 + 0.05, wheel.radius * 2 + 0.05]}
              position={[0, 0, 0]}
              baseColor="#000000"
              showBase={false}
              region={region}
              selected={selectedMeshName === wheel.meshName}
              onSelect={onSelectPart}
            />
          </group>
        );
      })}

      {PART_LAYOUT.map((part) => {
        // Internal-only components (engine, crash bar, radiator support, sensors)
        // only render in X-ray mode — there's nothing to see otherwise.
        if (part.hidden && !showInvisible) return null;

        const region = activeRegions.find((r) => r.meshName === part.meshName) ?? null;

        return (
          <DamageOverlay
            key={part.meshName}
            meshName={part.meshName}
            size={part.size}
            position={part.position}
            rotation={part.rotation}
            baseColor={part.color}
            radius={part.radius}
            material={part.material}
            showBase={showBase}
            // Hidden parts float their own distinct indicator, not on the body
            // surface a body-pick tap would hit — they keep a normal hit box.
            interactive={part.hidden ? true : !bodyPickMode}
            region={region}
            selected={selectedMeshName === part.meshName}
            onSelect={onSelectPart}
          />
        );
      })}
    </group>
  );
}
