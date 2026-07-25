# Claude Code task — Make the real prediction workflow function (VIN → OEM catalogue × interpreter → hidden-part predictions)

Before writing any code, **think through this exact workflow and trace it in the code**,
stage by stage, then make each hand-off real and verifiable. The predictions must be
**derived from the specific vehicle's OEM catalogue**, joined to Partly's interpreter
output — NOT inferred from the make/model name. "Toyota Yaris" is not enough to know its
parts; the **VIN's OEM catalogue is**. That principle is the whole point of this task.

Backend focus (`backend/`). Keep the existing design/architecture; make the data flow
correct.

---

## The workflow (implement/verify it exactly, in this order)

**Stage 1 — Rego → VIN → OEM catalogue.**
The repairer enters a rego. Partly's system resolves it to a VIN. **We already have the
VIN, so treat the lookup as done — but the resulting catalogue must be the one keyed to
that VIN/vehicle, not a generic or name-based guess.** In code: `rego → slug` via
`tables/rego_map.py` (which already carries the VIN), then load **that vehicle's**
`data/vehicles/<slug>/assemblies.json` via `catalogue/registry.load` → `build_parts`
(the OEM parts, with real `part_id`s) + `build_edges` (the OEM connectivity: this
vehicle's `sub_assembly_ids` + the rule edges). The loaded catalogue and its graph are
the vehicle-specific ground truth everything downstream must use.

- Verify: the catalogue in play is the one for the resolved slug/VIN; its `part_id`s are
  this vehicle's. Nothing downstream may invent parts from the model name.

**Stage 2 — Photos → interpreter (visible damage).**
The repairer uploads photos; Partly's interpreter identifies the visibly damaged parts.
**We assume/use the precomputed interpreter output** in
`data/predictions/<slug>.json` (treat it as the live result of analysing the photos).
`catalogue/interpreter.parse` already extracts the damaged parts as real OEM `part_id`s
(`oem_parts[].associated_oem_parts[].part_id`) plus zone/side/severity.

- Verify: every damaged `part_id` the interpreter emits **resolves into this vehicle's
  loaded catalogue** (it should — confirmed 100% match for the shipped files). If any
  doesn't resolve, that's a bug in the join — surface it, don't silently drop it.

**Stage 3 — Join interpreter × OEM catalogue → predict hidden damage.**
This is the core: seed the graph with the interpreter's damaged parts as **observed
evidence**, then propagate across **this vehicle's OEM connectivity** to predict the
parts likely damaged but not visible in any photo. In code: `evidence_service.merge`
(interpreter parts → observations) → `orchestrator.run` → `graph.propagate` over the
catalogue's edges → `buckets.split` (visible vs predicted).

- Verify the join is real and vehicle-specific: the hidden predictions are reached by
  walking edges **from the observed parts** through **this catalogue's** graph. Every
  predicted `part_id` must belong to the loaded vehicle's `assemblies.json`. The
  propagation must actually start from the interpreter's parts — a prediction that would
  be identical regardless of the interpreter output means the join is broken.

---

## What "make sure this works" means — do all of it

1. **Trace and log the chain for the Yaris (`QMN16`).** Prove, with a script or test
   output in the PR: rego `QMN16` → slug `toyota-yaris-qmn16` → VIN
   `JTDKBAA3301006094` → catalogue loaded (N parts, M edges) → interpreter damaged
   parts (list the resolved OEM part_ids + names) → hidden predictions (list part_ids +
   names + the observed parent each was reached from).

2. **Guarantee provenance at each hand-off** (add assertions/tests):
   - The loaded catalogue's slug matches the resolved rego/VIN.
   - Every observed (interpreter) `part_id` ∈ this vehicle's catalogue.
   - Every predicted `part_id` ∈ this vehicle's catalogue.
   - Each hidden prediction's attribution names an observed part (or a chain from one)
     that is **edge-connected in this vehicle's graph** — i.e. the prediction is caused
     by the interpreter's damage, not by a global prior alone.

3. **Prove the predictions actually depend on the interpreter input.** Add a test: with
   the real interpreter parts, the hidden set is non-trivial and front-right-consistent;
   with the interpreter parts removed/emptied, those hidden predictions collapse. If
   removing the observed damage barely changes the output, the join isn't driving the
   prediction — fix that (the propagation must flow from observations through edges, see
   `engines/graph.py`).

4. **Sanity-check plausibility** (the predictions must feel logical): for the Yaris
   front-right impact the hidden parts are the ones physically behind/attached to the
   visible damage (bumper reinforcement, energy absorber, radiator support, right
   headlamp bracket, crash box), on the correct side, each with a reason that names a
   real connected parent. No rear/opposite-corner/interior parts. Fix causes in
   `edges.py` / `edge_prior.py` / `tagger.py` / the zone-side filter, not symptoms.

5. **Do not shortcut with the model name.** There must be no code path that produces the
   parts list from make/model/label. If any such placeholder exists, replace it with the
   VIN-resolved catalogue join.

---

## Constraints

- Keep the design and the existing engine math (noisy-OR, attribution, graph); this is
  about making the **data flow** correct and provable, plus fixing any broken join.
- Engine stays pure/deterministic; respect latency budgets (full run ≤ ~400 ms).
- If you also apply the ranking/clutter fixes, coordinate with `CLAUDE_CODE_TASK.md`
  (the de-saturation + hardware-grouping brief) — don't duplicate or conflict; this task
  is specifically about the rego→VIN→catalogue×interpreter→prediction chain being real.

## Acceptance

- A script/test prints the full Yaris chain in §"make sure this works" #1.
- All provenance assertions (#2) pass.
- The dependence test (#3) passes: emptying interpreter evidence collapses the hidden
  predictions.
- Plausibility holds (#4): predicted parts are front-right, catalogue-resident, and each
  explains itself via a genuinely connected parent.
- No parts are ever derived from the model name (#5).

Start by reading `tables/rego_map.py`, `catalogue/registry.py`, `catalogue/loader.py`,
`catalogue/edges.py`, `catalogue/interpreter.py`, `services/evidence_service.py`,
`engines/orchestrator.py`, and `engines/graph.py`, then trace the Yaris chain before
changing anything.
