# Claude Code task — Make the hidden-damage engine correct (BACKEND fixes)

You are working in the `partli` / `partly-hackathon` monorepo (`backend/` = FastAPI).
**Keep the existing design and architecture** — this is fix, not redesign. Read the whole
brief, reproduce the current behaviour, post a short plan for approval, then implement.

> **SCOPE: backend only.** The demo runs on the **mobile app** (`apps/mobile`), not web.
> The capture UI (rego → photos → live analysis) and the parts-list styling are handled
> by separate mobile prompts (`CLAUDE_CODE_TASK_FLOW.md`, `CLAUDE_CODE_TASK_UI_PARTS_LIST.md`).
> **Do not build or modify any web frontend here.** Section 3 below is retained only as
> the API contract the mobile app consumes — implement the endpoints/response fields, not
> a web page.

---

## 0. What the product is (the design to PRESERVE)

The app predicts *hidden* collision damage:

1. Repairer enters a rego → the real OEM parts catalogue for that vehicle loads.
2. Crash photos are added.
3. Partly's shipped prediction (`data/predictions/<slug>.json`) gives the **visible**
   damaged parts (bumper cover, headlamp, grille…). This is the evidence.
4. Our engine propagates that across the component graph (noisy-OR over the OEM
   catalogue connectivity) to output the **hidden** parts damaged but in no photo —
   `bumper cover destroyed → energy absorber → reinforcement bar → crash box →
   radiator support` — each ranked, each with a one-line reason.
5. The repairer ticks/crosses a part and the list re-propagates and re-ranks live.

**The demo we must be able to run, verbatim:**

> Enter a rego → the real catalogue loads → drop in the crash photos → and instead of
> "bumper's damaged" (which everyone can see), the screen fills with specific part
> numbers that aren't in any photo, ranked, each explaining itself. Then you tick one,
> and the list rearranges in real time. Takeaway: *"it's ordering parts I can't see."*

Right now this cannot be run at all: the web app has **no capture flow** (its own
comment says "the repairer captures damage in the mobile app"), and the engine output
is broken (below). This task delivers both halves.

---

## 1. Backend root cause — read first, it explains three symptoms

Reported: (1) the parts list is **extremely cluttered**; (2) the **probabilities don't
change** when you tick/cross; (3) it asks an **irrelevant question** ("Are the wheels
sitting straight?") on a front-corner bumper hit.

**(1) and (2) are one bug: noisy-OR saturation.** Verified on the Yaris: ~55 parts come
back at p ≥ 0.999, ~19 of them clips/retainers. A single fastener is a `hardware`/
`mounts` child of several damaged parents (bumper cover, fender, grille, headlamp all
fire λ≈0.7–0.9 into the same front-end fastener pool); the noisy-OR combines them to
≈1.0. So the list is a wall of identical 1.00s (clutter), a part already at 1.0 can't
move on confirmation (frozen probabilities), and the question engine measures movement
in a graph where nothing moves (junk questions). **De-saturation is the linchpin.**

Two more confirmed, separate bugs:
- **De-dup is broken:** `buckets._dedupe` keys on `(name, part_number)`; the five "Right
  Front Guard Grommet" rows have different part numbers so they survive and eat order
  slots. Key on `name` instead.
- **Fasteners are top-level order lines** instead of nested under their parent part.

Do **not** rewrite the noisy-OR, attribution split, graph construction, or bucket
concept — they are sound. Everything below is tuning, aggregation, grouping, gating,
and new UI.

---

## 2. Backend fixes

### 2A. De-saturate the noisy-OR (linchpin) — `engines/graph.py`, `tables/edge_prior.py`, `tables/constants.py`
Bound how much shared low-value sinks accumulate; keep the survival-product math intact.
Use whichever combination is cleanest and comment the reasoning:
- Cap the number and/or combined contribution of incoming `hardware`/`mounts` edges per
  target, or apply diminishing returns, so N parents don't drive one shared clip to 1.0.
- And/or lower λ for generic sink classes (`clip`, `cover_retainer`) in `edge_prior.py`.

Acceptance: Yaris `order` is no longer ≥5 parts at p≥0.999; probabilities spread; and
confirming a parent visibly moves its dependents (2E).

### 2B. Fix de-dup — `engines/buckets.py::_dedupe`
Collapse rows naming the same component regardless of part number. Key on `part.name`
(optionally `(name, diagram_id)`), keep the highest-p instance, track a collapsed
count/quantity. Stays before the caps (already does — preserve).

### 2C. Group hardware/consumables under their parent — `engines/buckets.py` (+ helper)
Consumable-tier klasses (`clip`, `cover_retainer`, `grommet`, `seal`, `splash_shield`,
`undercover`, `fender_liner`, similar) must not be standalone top-level `order` lines.
Fold each under its substantive parent using relations you already have: interpreter's
`hardware_kit` → parent (`catalogue/interpreter.py`) and edge `hardware` /
`sub_assembly` relations (`catalogue/edges.py`). Emit `order` items with nested
`hardware: [{part_id, name, p}]`; orphan consumables go in one collapsed
"hardware/consumables" group. **Rank `order` by probability desc** after grouping — no
structural reweighting; once de-saturated, honest probability is the ranking.

### 2D. Relevance-gate clarifying questions — `engines/counterfactual.py::next_question`, `api/v1/case.py`
Questions must be relevant to the actual impact, not just severity-boundary math.
`q_wheels` must NOT fire on a front-corner cosmetic hit. Gate every candidate:
1. It must change the bucket of **substantive** (non-hardware) parts — reshuffled
   fasteners don't count.
2. **Contextual relevance:** `q_wheels` / any wheel-suspension-steering discriminator
   fires only when wheel-region parts (wheel_hub/knuckle/suspension_arm/…) are real
   candidates with meaningful probability, or evidence indicates a wheel-first / lower /
   high-severity structural impact. Same idea for `q_airbags`, `q_door`.
3. Keep existing rules (one question max, must clear `QUESTION_MIN_BUCKET_MOVES`,
   answerable where the repairer stands). Keep `q_side` — the Yaris frames genuinely
   disagree on side. Prefer a general relevance mechanism over one-off hardcodes.

### 2E. Confirm loop must visibly move the list — `services/case_service.py`, `api/v1/prediction.py`
After 2A, verify `/inspection/confirm`: confirming **damaged** promotes to `visible` and
raises dependents; confirming **clean** removes and measurably lowers dependents (real
delta, not a rounding wobble); response returns the updated report. Keep the ~150 ms
confirm budget (no re-ranking on confirm, as designed).

### 2F. Restrict to the 3 catalogued vehicles — `api/v1/vehicle.py`, `tables/rego_map.py`
Only `QMN16` (Toyota Yaris), `PNS53` (Hyundai Santa Fe), `RFH447` (Jaguar E-Pace) may
register (only these ship an `assemblies.json`). Every other `REGO_MAP` entry is
rejected at `/vehicle/register` with `ApiError("rego_not_allowed", …)` naming the 3.
Add `GET /vehicles/allowed` → `[{rego, make, model, year, slug}]` for the 3.

### 2G. Photo upload: accept + track (do not analyse) — `api/v1/media.py`, `services/media_service.py`, `store/cases.py`, `services/report_service.py`
`/media/upload` (multipart: `case_id`, `kind`, `files[]`) must store the images tied to
the case and let us tell which were uploaded: each gets a stable `media_id`, keeps
`filename`, `kind`, `content_type`, size, `uploaded_at`. Expose them for read — add
`GET /case/{case_id}/media` and include a `media` array in the case/report payload — and
serve the bytes back for thumbnails (e.g. `GET /media/{media_id}` returning the image).
Uploaded photos do **not** drive the prediction and do **not** replace dataset frames;
recorded and listed only. Keep existing size/count limits.

### 2H. Re-check the prediction logic for accuracy and physical plausibility — `engines/*`, `catalogue/edges.py`, `tables/*`
The hidden-damage predictions are the product, so they must be **accurate and feel
logical** — a repairer looking at the list should think "yes, those are exactly the
parts behind what's smashed," not "why is that there?" Do a deliberate correctness pass,
not just the saturation tuning:

- **Trace the Yaris end to end and sanity-check every predicted part.** For the front-
  right impact, the hidden list should be the parts genuinely behind/attached to the
  visible damage — energy absorber, reinforcement bar, crash box, radiator support,
  headlamp bracket, fender liner — and their `reason` should name a real, correct
  causal parent (e.g. "behind the bumper cover", "carries the headlamp"). Read the
  actual output and confirm each line makes sense.
- **Catch nonsense.** No rear/interior/opposite-corner parts on a front-corner impact;
  no part whose `reason` points to a parent it isn't actually connected to; no
  "hidden" prediction for something that's really just a trim clip. If any appear, the
  bug is in the edges (`edges.py` / `edge_prior.py`), the tagging (`tagger.py` /
  `klass_rules.py`), or the zone/side filter — fix the cause, don't mask it.
- **Verify the propagation direction and gates read correctly:** energy flows outer→
  inner along real load paths; the depth gate and zone/side filter actually exclude
  parts the impact could not reach; each edge relation (`hardware`/`mounts`/`load_path`/
  `adjacent`) is used the way its λ intends.
- **Confirm the reasons match the math.** The one-line `reason` and the attribution must
  reflect the parent that actually drove the probability, so the explanation a repairer
  reads is the true cause, not a template.
- Where the logic is currently wrong or arbitrary, correct it and note what you changed
  and why. Add plausibility assertions to the tests (below) so it can't silently
  regress. This is an explicit instruction to **audit and improve the reasoning, not
  just re-tune numbers.**

---

## 3. API contract the mobile app consumes (backend endpoints only — NO web page)

**Do not build a web frontend.** This section previously described a web page; ignore
that. What the backend must guarantee is that the endpoints and response fields below
exist and are correct, so the **mobile** app (`apps/mobile`, covered by
`CLAUDE_CODE_TASK_FLOW.md`) can drive the rego → photos → live-analysis flow. Implement
the endpoints/fields; skip anything that says "render", "column", "page", or "component".

### 3.1 Route & shape
Add a route, e.g. `app/inspect/page.tsx` (link it from `app/page.tsx`). The interactive
capture is a **client component** (`'use client'`) driving the whole flow as an explicit
staged pipeline the judge can follow on screen. **Rego is entered FIRST, before photos.**
The stages, in order, each with a visible status the user can see complete:

`rego entry → VIN resolved → OEM catalogue + part connections loaded → photos uploaded →
Partly interpreter: visible damage → our engine: hidden-damage prediction → live report`

Surface each stage as it completes (a stepper, checklist, or status line) so the story
reads: *the vehicle's exact parts and how they connect come from the VIN; the visible
damage comes from Partly; the hidden parts come from us.* That legibility is the pitch.

### 3.2 Keep the API private — proxy through Next
`lib/api.ts` is server-side (internal `API_URL`, backend not publicly reachable). Keep
that. For the browser flow, add thin **Next Route Handlers** under `app/api/*` (or
server actions) that forward to the backend using `API_URL`:
- `POST app/api/register/route.ts` → `/v1/vehicle/register`
- `GET  app/api/vehicle/[id]/route.ts` → `/v1/vehicle/{id}` (poll until resolved)
- `POST app/api/case/route.ts` → `/v1/case`
- `POST app/api/media/route.ts` → forwards multipart `FormData` to `/v1/media/upload`
  (read the incoming `FormData`, re-post to backend; do not JSON-encode)
- `POST app/api/prediction/route.ts` → `/v1/prediction/run`
- `GET  app/api/results/[caseId]/route.ts` → `/v1/prediction/results/{caseId}`
- `POST app/api/confirm/route.ts` → `/v1/inspection/confirm`
- image thumbnails: `GET app/api/media/[mediaId]/route.ts` → streams `/v1/media/{id}`

Add matching typed methods to `lib/api.ts` (or a client-side `lib/client.ts`) so the
page calls named functions, not raw fetches.

### 3.3 The flow the page implements (this IS the demo — build it exactly)
1. **Rego entry — FIRST.** Input + "Look up vehicle". On submit → register → poll the
   vehicle until resolved. Show the resolved identity: **VIN**, make/model/year, and a
   confirmation that the **OEM catalogue and part connections loaded** (e.g. "4,000+
   parts, N connections indexed" from catalogue stats if available). This is the
   "the real catalogue loads" beat — the exact vehicle and how its parts connect come
   from the VIN, before any photo. Show the backend's `rego_not_allowed` message cleanly
   if it's not one of the 3 (optionally prefill allowed regos from `GET /vehicles/allowed`).
2. **Create case** for the resolved vehicle (once, behind the scenes).
3. **Add photos — SECOND.** A real file input (`accept="image/*"`, `multiple`) with
   drag-and-drop and thumbnail previews. On "Upload", POST the `FormData`
   (`case_id`, `kind="damage"`, `files`) via the media route handler; show the uploaded
   photos from the tracked media list (proof upload worked). Allow adding more.
4. **Partly interpreter → our engine.** Run prediction, then fetch results. Show the two
   inference stages as distinct beats so the handoff is legible: first *"Partly
   interpreter: visible damage detected"*, then *"Our engine: propagating hidden
   damage"*. (Both resolve from the same results call; present them as two labelled
   steps, not one opaque spinner.)
5. **Render the result as two columns — this contrast is the whole pitch. The two
   columns are visually different ON PURPOSE, because they mean different things:**
   - **"Camera saw — Partly"** = `visible`: the parts Partly's interpreter identified as
     damaged in the photos (bumper cover, headlamp, grille…). These are **observed
     facts, not predictions — so DO NOT show a probability or confidence on them.** They
     are confirmed damage. Present them plainly (part name + number, "damaged / detected
     by Partly"), smaller/muted. This is the "bumper's damaged, everyone can see that"
     side. Showing a percentage here is wrong and undercuts the point.
   - **"Hidden — we predict"** = `order`: the star, and the ONLY place a probability
     belongs, because these ARE predictions. Specific part numbers that appear in **no
     photo**. Each item shows part name, part number, a **likelihood indicator** (this
     is our engine's confidence the hidden part is damaged), its one-line `reason`
     ("explaining itself"), and nested `hardware` (collapsible "+ N fasteners"). Ranked
     by likelihood. No duplicate names, no fastener wall.
   - Rule of thumb for the whole UI: **observed = no number; predicted = number.** If a
     part is in `visible` (Partly saw it) or has been confirmed by the repairer, it
     shows no probability. Only un-observed, engine-inferred parts show one.
   - Also surface `check`/`inspect_first` modestly, and the single clarifying question
     if present (answer buttons → post answer → refetch). No `q_wheels` on the Yaris.
6. **Tick / cross each hidden part → live rearrange.** ✓ = confirm damaged, ✗ = confirm
   clean → POST confirm → re-render from the returned report so **the list visibly
   rearranges in real time** (a crossed part drops out and its dependents fall; a
   confirmed part promotes and lifts its dependents). This is the money moment and the
   judges' takeaway — *"it's ordering parts I can't see"* — so make it smooth and
   obviously live (optimistic UI or a fast refetch; animate the reorder if cheap).

### 3.4 Notes
- Handle loading/empty/error states (API down, rego rejected, no photos yet).
- Don't block the render on `ApiError`; show the message.
- Env: browser talks only to `app/api/*`; those use `API_URL` (default already
  `http://localhost:8080`). Note the dev command in the PR.

---

## 4. Constraints

- **Keep the design** — no new engine, no new bucket model, no removed capabilities;
  keep `/dashboard` and `/approve/[token]` working.
- Response shapes: only **add** fields (`hardware` on order items, `media`, collapsed
  `quantity`, `visible`/`order` already exist); don't rename/remove. List additions in
  the PR.
- Engine stays pure/deterministic (`propagate`, `candidate_set`, `orchestrator.run` —
  no I/O/side effects).
- Latency budgets: full run ≤ ~400 ms, confirm ≤ ~150 ms.
- No new heavyweight deps; reuse existing UI components and styling.

---

## 5. Acceptance criteria

**Backend tests** (in `backend/tests/`, driven by the real Yaris catalogue + shipped
prediction):
1. No saturation wall: `order` not ≥5 items all at p≥0.999; probabilities spread.
2. Probabilities respond: confirming a chosen parent *clean* lowers a specific
   downstream part's p by a meaningful margin vs *damaged* (assert a real delta).
3. No duplicate `part.name` in `order`.
4. No bare consumable-tier klass as a top-level `order` line (nested or grouped only).
5. Substantive parts surface (bumper reinforcement, energy absorber, radiator support,
   headlamp bracket) in `order`.
6. `next_question` does NOT return `q_wheels` on the Yaris front-corner case; a
   wheel-region scenario still allows it.
7. Registration allow-list: the 3 register; every other `REGO_MAP` entry is rejected.
8. Media tracking: after uploading N images, the read endpoint returns N entries with
   distinct `media_id`s and correct `filename`s.
9. Confirm loop: confirming promotes to `visible`; denying removes and re-propagates.
10. **Plausibility:** for the Yaris front-right case, every `order` item is in the
    front zone (no rear/interior/opposite-corner parts), and each item's top
    attribution names a parent it is actually edge-connected to. Assert it.
11. **Reason integrity:** each `order` item's `reason`/attribution reflects the parent
    that actually drove its probability (not a static template).

**Frontend / end-to-end** (manual, document in PR) — must reproduce the demo in order:
- **Display rule:** parts in the "Camera saw — Partly" (`visible`) column show **no
  probability**; only the "Hidden — we predict" (`order`) parts show a likelihood.
  Confirmed parts also show no probability. Verify on screen.
- Enter rego `QMN16` **first** → VIN + make/model/year resolve and the OEM catalogue /
  part connections show as loaded (before any photo) → select and upload 2–3 crash
  photos → thumbnails appear → the page shows the two inference beats (Partly: visible
  damage → our engine: hidden prediction) → the **"Hidden — we predict"** column fills
  with specific part numbers NOT in the photos, ranked, each explaining itself, with
  nested hardware, cleanly (no dup/fastener wall), beside a muted **"Camera saw —
  Partly"** column → tick/cross a hidden part → the list visibly rearranges in real
  time. Include screenshots or a short clip.
- `typecheck` and `lint` pass for `apps/web`.

---

## 6. Deliverables

1. Approved plan (post before coding): de-saturation approach, question-relevance
   mechanism, and the frontend page/route-handler structure.
2. Backend changes + new frontend capture page and route handlers.
3. Passing `pytest`; passing web `typecheck`/`lint`.
4. Concise PR summary: response fields added; before/after Yaris `order` bucket;
   before/after confirm-loop probabilities; confirmation `q_wheels` no longer fires;
   how to run the full demo (`uvicorn … --port 8080` + `pnpm --filter @partli/web dev`),
   and the click-path for §5.

Start by reading `engines/graph.py`, `engines/buckets.py`, `engines/counterfactual.py`,
`catalogue/edges.py` and the tables (backend), and `apps/web/lib/api.ts` +
`app/page.tsx` (frontend). Reproduce the Yaris `order` bucket and the `q_wheels`
question before changing anything.
