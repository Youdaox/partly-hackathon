# generic-car.glb

Drop the real generic-car model here as `generic-car.glb` once it exists. Until then,
`InspectionViewerScreen` renders `components/VehicleViewer/PlaceholderCarModel.tsx`
instead — a procedural stand-in with the same named parts, so the feature is fully
demoable without this file.

Required mesh names (used as the join key against `DamageRegion.meshName`):

- FrontBumper
- LeftHeadlight
- RightHeadlight
- Hood
- LeftFender
- RadiatorSupport
- CrashBar
- Sensors

## Switching to the real model

In `components/VehicleViewer/VehicleViewer.tsx`, swap `PlaceholderCarModel` for
`GlbCarModel` (already written in the same folder):

```tsx
<GlbCarModel
  source={require('../../../assets/models/generic-car.glb')}
  activeRegions={activeRegions}
  selectedMeshName={selectedMeshName}
  onSelectPart={onSelectPart}
/>
```

`GlbCarModel` reads mesh names straight off the loaded scene graph, so no other file
needs to change — `mockDamageData.ts`, `DamageOverlay`, and the bottom sheet are all
already written against real mesh names, not placeholder-specific logic.
