# Claude Code task — Make the two interfaces agree (align the hardcoded 3D inspection with the prediction demo)

Small, self-contained task. The 3D inspection can stay **hardcoded / mock** — do NOT
wire it to the backend. The only goal is that the app's **two interfaces tell the same
story**: the parts-prediction flow and the 3D damage inspection must show the **same
vehicle** and the **same damaged parts**, so moving between them is one coherent demo,
not two different cars.

Keep the existing design, components, 3D viewer, overlays, camera, and UX unchanged.
This is a **data-and-labels alignment**, not a redesign or a backend integration.

---

## The problem

- **Prediction interface** (the demo we pitch): **Toyota Yaris, rego `QMN16`,
  front-RIGHT collision.** Visible (Partly): front bumper cover, right headlamp, grille
  (+ emblem). Hidden (our engine): bumper reinforcement bar, energy absorber, radiator
  support, headlamp bracket, crash box.
- **3D inspection** (`apps/mobile/src/data/mockDamageData.ts` +
  `screens/InspectionViewerScreen.tsx`): a *generic* **"Toyota Corolla 2022,"
  front-LEFT** car with unrelated mock parts (`LeftHeadlight`, `LeftFender`, `CrashBar`,
  `Sensors`) and a hardcoded header.

These disagree on vehicle, on side, and on the parts. Fix the 3D side to match.

---

## Canonical demo (single source of truth — both interfaces must match this)

**Vehicle:** Toyota Yaris, 2023, rego `QMN16` — front-right collision.

**Visible damage (Partly — OBSERVED, show NO probability):**
- Front bumper cover
- Right front headlamp
- Radiator grille (+ grille emblem)

**Hidden damage (our engine — PREDICTED, show a likelihood):**
- Front bumper reinforcement bar
- Front bumper energy absorber
- Radiator support
- Right headlamp bracket
- Crash box / front chassis rail

(If the prediction interface's fixed/real Yaris output differs slightly, the 3D mock
should mirror *that* — the prediction flow is the source of truth. Keep the two lists
identical in wording where a judge can see both.)

---

## What to change in `apps/mobile`

1. **Vehicle identity.** Replace the hardcoded `"Toyota Corolla 2022"` /
   `"Front collision assessment"` defaults in `InspectionViewerScreen.tsx` with the
   canonical **Toyota Yaris, front-right collision** (match the label the prediction
   interface uses). Keep the `params.vehicleLabel` override, but the fallback must be
   the Yaris, not a Corolla.

2. **Rewrite `mockDamageData.ts` to the canonical parts above.** Same visible/hidden
   split, same part names, same side. Visible = `damageType: 'visible'`, hidden =
   `damageType: 'invisible'`. Make the `explanation` lines physically sensible and
   consistent with the prediction reasons (e.g. absorber/reinforcement "behind the
   bumper cover"; headlamp bracket "carries the right headlamp").

3. **Side must be RIGHT.** The impact is front-right, so highlighted meshes are on the
   right (e.g. `RightHeadlight`, `RightFender` / front-right regions), NOT left. Update
   `mockDamageData` mesh names accordingly, and ensure the placeholder model
   (`components/VehicleViewer/PlaceholderCarModel.tsx` / `carLayout.ts`) actually has
   the right-side / front regions the data references so they light up. Keep the model
   generic and the design unchanged — just make sure the meshes the data points at exist
   and are on the correct side.

4. **Honour the display rule (agree with the other interface):** visible/observed parts
   show **no probability** in the bottom sheet, damage cards, and summary — present them
   as detected/confirmed. Only hidden (`invisible`) parts show a likelihood. If the
   overlay opacity needs a number, keep `confidence` in the data for rendering but do
   **not** display a percentage on visible parts. (The prediction interface follows the
   same rule; both must match.)

5. **No leftover contradictions.** Remove any mock part that isn't in the canonical set
   (e.g. generic "Parking sensors" unless it's in the prediction story). Every part
   shown in 3D must also be a part the prediction interface would show for this vehicle,
   and vice-versa for the headline items.

---

## Constraints

- Mobile only, and only the inspection data/labels + placeholder mesh regions. Do not
  touch the backend, do not add a real detection/prediction call, do not restyle.
- Keep the 3D viewer, overlays, toggle, bottom sheet, exploded diagram, and camera as-is.
- Reuse the existing `DamageRegion` type; keep the `meshName` join-key mechanism.

## Acceptance

- Open the 3D inspection: header reads **Toyota Yaris** (front-right collision), not a
  Corolla.
- Toggle **visible**: front bumper cover, right headlamp, grille highlight on the
  **front-right**, with **no probability** shown.
- Toggle **hidden**: reinforcement bar, energy absorber, radiator support, headlamp
  bracket light up (front-right), each with a likelihood and a sensible reason.
- Side-by-side with the prediction interface for `QMN16`, the **same vehicle** and the
  **same headline parts** appear in both — nothing that looks like a different car.
- `typecheck` / `lint` pass for `apps/mobile`.

Start by reading `apps/mobile/src/data/mockDamageData.ts`,
`screens/InspectionViewerScreen.tsx`, `components/VehicleViewer/PlaceholderCarModel.tsx`
and `carLayout.ts`, plus whatever the prediction interface renders for `QMN16`, so the
two are worded the same.
