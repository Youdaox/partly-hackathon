# toyota_gr_corolla.glb

"Toyota GR Corolla" by Nieve5677 ([Sketchfab](https://sketchfab.com/3d-models/toyota-gr-corolla-6e0324b8fd9a4b669ea4105db4c7c8d8)),
licensed [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) — keep that
attribution if this ships anywhere beyond the hackathon demo.

Loaded by `components/VehicleViewer/GlbCarModel.tsx`, which is what
`VehicleViewer.tsx` renders by default. `PlaceholderCarModel.tsx` (procedural
boxes, no external asset) is the fallback if the GLB ever fails to load — same
props, drop it back into `VehicleViewer.tsx` in place of `GlbCarModel`.

## Why parts are overlaid, not part of the model

The file has real detail — ~170 meshes — but every one carries a generic
exporter-assigned name (`desirefx.me_042`, ...), not `hood` or `door_left`. So
there's nothing semantic to match a `DamageRegion.meshName` against.

Instead, every locatable part (`PART_LAYOUT` and `WHEEL_LAYOUT` in
`../../components/VehicleViewer/carLayout.ts`) is a hand-placed, invisible region
floating over the loaded body, positioned from the model's *real* world-space
bounding box — computed by composing all 336 nodes' transform matrices (this
export bakes per-mesh matrices rather than simple translation, so a naive "sum
the accessor min/max" gives nonsense — see the long comment above
`MODEL_RECENTER` in `carLayout.ts` for the full derivation):

```
length (Z) 4.40   width (X) 2.06   height (Y) 0 → 1.48   +Z = front, +X = left
```

`MODEL_SCALE`, `MODEL_ROTATION_Y`, and `MODEL_RECENTER` in `carLayout.ts` are the
exact correction (this model happens to already be in metres, but its native
length axis is X, not Z, and it isn't centred on the origin).

**Not visually confirmed** — there was no way to render this from here, so:

- Which end is the front and which side is left was inferred, not verified. If
  the car looks back-to-front or mirrored, flip `MODEL_ROTATION_Y`'s sign
  (front/back) or the X sign across `PART_LAYOUT`/`WHEEL_LAYOUT` (left/right) —
  don't re-derive the bounding box, it's the axis assumption that's a guess, not
  the numbers.
- The four wheel positions are estimated from typical hatchback axle placement,
  not read off the model's own wheel meshes (unlike the previous model, this
  one's wheels weren't isolated from its ~170 anonymous meshes in the time
  available) — worth truing up against the actual wheel arches once someone
  looks at the render.

## Swapping in a different model

1. Extract its true world-space bounding box: parse the `.glb`'s JSON chunk
   (12-byte header, then a length-prefixed JSON chunk — plain glTF), then for
   every node that has a `mesh`, compose that node's full transform (walk
   ancestors from the scene root, multiplying each node's `matrix` — or its
   composed translation/rotation/scale if it has no baked `matrix`) and apply it
   to that mesh's accessor `min`/`max` corners. Don't just take accessor
   min/max directly — if any node in the hierarchy carries a matrix (common from
   FBX/3ds Max exports, as here), that's wrong by a large margin.
2. Update `MODEL_SCALE` / `MODEL_ROTATION_Y` / `MODEL_RECENTER` and re-place
   `PART_LAYOUT` / `WHEEL_LAYOUT` in `carLayout.ts` for the new proportions.
3. If the new model *does* ship named per-panel meshes, `GlbCarModel` could go
   back to matching `DamageRegion.meshName` against real node names instead of
   hand-placed overlays — simpler, but only works if the model actually has that
   geometry split out (neither model tried so far has).
