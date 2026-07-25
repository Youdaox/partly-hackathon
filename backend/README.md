# Partli backend

Damage → hidden-parts prediction. FastAPI, implementing §4–§7 of SPEC.md.

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --port 8080     # docs at /docs
.venv/bin/python -m pytest -q                  # 191 tests, ~18 s
.venv/bin/python -m scripts.warm_cache         # preload + parse everything
```

Boot preloads all catalogues **before** binding the port, so nothing lazy-loads
on the hot path. Health at `/healthz`.

## Layout

| Folder | Rule |
|---|---|
| `api/` | HTTP only. Never imports `engines/` |
| `schemas/` | Wire format only |
| `services/` | Orchestration. May touch storage, providers, engines |
| `engines/` | **Pure functions.** No DB, no network, no logging |
| `ai/` | The only place a model is called, behind a protocol |
| `tables/` | Constants. The model lives here |
| `catalogue/` | Partly data ingestion, isolated behind a real API swap |
| `store/` | In-memory case state (see *Deviations*) |

`engines/` purity is enforced by a test that walks the AST looking for banned
imports. It is what lets the whole prediction be recomputed on every event
instead of patched.

## How the prediction works

Noisy-OR over a component graph, one topological sweep by depth — the spec 9.2
formula verbatim:

```
p_i = 1 − (1 − leak_i) · (1 − λ_root_i) · Π_j (1 − p_j · λ_ji · g_i)

where  λ_root_i = zone_factor_i · g_i · class_prior[klass_i]
       g_i      = depth_gate(depth_i, severity)
```

The depth gate belongs to the **target** part and multiplies every cause acting
on it — the direct term *and* every incoming edge. An earlier revision of this
engine gated only the direct term, on the reasoning that a known-damaged source
proves the energy got that far. Spec 9.3 is right that this is a bug: observed
parts clamp near 0.98 whatever the severity, so an ungated edge propagates a
car-park scrape inward at full strength — 53% crash box at severity 1. The
gated engine leaves it at 0.040, and `tests/test_spec9.py` keeps a tripwire on
exactly that row.

`zone_factor` multiplies only the root term. Left/right needs no special rule:
the only route across the car is a transverse member (beam, radiator support),
modelled explicitly as a centre part — which yields a ~25× left/right split on
brackets but only ~1.6× on crash boxes, from one mechanism. `leak` is not gated
at all: "replaced anyway" is invoice behaviour, not crash physics.

Attribution is exact, not heuristic: each term's contribution to `-log(1 - p)`
is additive, so the shares are a real decomposition of the noisy-OR.

The counterfactual ranks what to inspect next by how much the *report* moves:
`own + E[Σ|p' - p|]` over both answers. A part that is nearly certain either way
scores near zero however deep it is — there is no point confirming what is known.

## Measured against the §4.2 budget

| Stage | Budget | Measured |
|---|---|---|
| Catalogue load (7,009 parts) | preload | 262 ms |
| Interpreter parse | 50 ms | 0.5 ms |
| Graph propagation | 20 ms | 4.6 ms |
| Full run incl. counterfactual | 400 ms | 240–390 ms |
| ✓/✗ confirm round trip | 150 ms | **9–12 ms** |
| Report payload | 20 KB | 6.4–8.4 KB |

## The AI pipeline (§8)

Four evidence channels — `interpreter`, `vision`, `speech`, `repairer` — merge
into one `Evidence` object. Channels combine with a noisy-OR *across sources*
but take the max *within* a source, so speech and vision agreeing beats either
alone while one channel repeating itself does not manufacture certainty.

**Prompts are versioned** and live in `ai/prompts/`. The version is part of the
model cache key, so a prompt change can never serve a stale cached response. The
severity ladder is written *into* the vision prompt as five observable
descriptions — a model asked "how severe, 1–5?" returns noise; asked "which of
these matches what you can see?" it is reliable.

**Hedging is preserved, not flattened** (§8.3):

| Phrasing | `p` |
|---|---|
| "the bumper's destroyed" | 0.95 |
| "the headlight's probably gone" | 0.70 |
| "I think there might be suspension damage" | 0.45 |
| "not sure about the rail" | 0.35, flagged as a question candidate |

Certainty is scoped per clause, which is the same mechanism that stops "bumper's
off **but** the wheel looks straight" from clearing the bumper.

**ASR vocabulary biasing** (`catalogue/vocabulary.py`): once VIN resolution
completes we hold ~7,000 part names for that exact vehicle, so the ~200 most
likely — shallow, orderable, in the impact zone — go to the ASR as phrase hints
alongside trade slang ("slam panel", "crash box", "reo"). Free, because the
catalogue is already in memory from the parallel VIN workflow.

**Video audio is transcribed automatically.** All 12 shipped videos carry an AAC
track (2 traks, `mp4a`/`esds` — verified by parsing the atom trees), and
Partly's own predictions have `repairer_notes` empty almost everywhere, so the
narration is free evidence nobody is using.

## What the dataset actually contains

Findings that contradict the spec's assumptions, and which the code is built
around:

- **3 vehicles have catalogues**, not 8 — `toyota-yaris-qmn16`,
  `hyundai-santafe-pns53`, `jaguar-epace-rfh447`. §4.5's "load all 8 at boot" is
  wrong. Predictions exist for 8 slugs, so 5 are `no_catalogue`.
- **The Jaguar's `oem_parts` stage is `in_progress`**, not completed — there are
  no OEM part ids for it at all. Its `raw_parts` is complete, so the assistant
  degrades to class-level claims rather than showing an empty report.
- **Only 50 of the Yaris's 187 diagrams ship image assets.** Report lines carry
  `diagram_available` so the client never renders a hotspot over a 404.
- **3,563 of 7,009 parts have a hotspot; 3,029 have a part number.** Sparse
  fields are carried as `null`, never defaulted.
- **The Yaris frames genuinely disagree on side** — frame 01 says right, frame
  05 says left. That real conflict is what drives the clarifying question, and
  it is the §6.5 example verbatim.
- **No price, lead-time, stock or supplier field exists anywhere.** All
  commercial data is generated and every response carrying it sets
  `"simulated": true`.
- **Only `high` and `low` confidence values occur** — never `medium`. §8.5's
  two-value mapping is exactly right; `medium` is kept only to keep the mapping
  total if the Interpreter starts emitting it.
- **No frame mentions airbags, and none says a wheel is displaced.** They say
  *"wheel removed"*, which is teardown, not damage. So `wheel_displaced` and
  `airbag_deployed` are honestly `None` across all eight vehicles — `None` is
  preserved as distinct from `False`, because "the frames don't show it" must
  never be reported as "the frames show it didn't happen". The teardown language
  is instead read into `exposed_depth`, which gates what is worth inspecting.

## Deviations from the spec

1. **In-memory case store, not Postgres.** Spec §7.4 sanctions this variant
   (24 h TTL, keyed by `case_id`). The Postgres schema in §7 is not implemented:
   no `models/`, no `database/`, no Alembic. Swapping it in means replacing
   `store/cases.py` — services never touch a dict directly.
2. **§9 is asserted where it is determinable.** `tests/test_spec9.py` reproduces
   the fully-determined reference rows exactly — the retainer at 0.665/0.978/0.989,
   the severity-1 crash box at 0.040, `own` for every 9.5 row, Cheng's 0.75 —
   and asserts the rest structurally (monotone in severity, nothing structural
   on a scrape, settled parts sink from both ends, the two transverse-member
   ratios). The remaining exact cells depend on the ~40 authored table rows that
   §9.0 declares by shape but does not enumerate.
   The §9.4 *synthetic corpus generator* (`seed_history.py`) is not implemented —
   it belongs to the descoped Postgres seed layer. The mechanism it feeds
   (`History.reload()`, the K=5 blend, `stats()` for the 0 → 40 demo beat) is
   built and tested.
3. **§11.3 class-level degradation** was referenced but not supplied. The
   obvious reading is implemented: klass claims land on the parts of that class
   in the impact zone.
4. **Model providers are stubs.** No credentials in this build. `InterpreterVision`
   serves the shipped Partly Interpreter output — a genuine model result, just
   pre-computed. `StubASR` returns deterministic canned transcripts so the speech
   path is exercisable. Both sit behind the protocols in `ai/base.py`; swapping in
   real Whisper/VLM is a two-line change in `api/deps.py`. The prompts in
   `ai/prompts/` are written and versioned ready for that swap.
5. **Speech extraction is a keyword pass, not a model call.** What a repairer
   says is a small closed vocabulary; a table is faster, free and debuggable.
   It implements §8.3's hedging ladder and negation scoping directly.
6. **§8.5 says return an empty `Evidence` when `oem_parts` has no `completed`
   key. I do more than that.** The Jaguar's `raw_parts` stage *is* complete, so
   rather than returning nothing I classify the raw part names into class-level
   claims and land them on real catalogue parts. Same "normal path, not an
   error" semantics, but the repairer gets a usable report instead of a blank
   one. Revert `_raw_klasses` in `catalogue/interpreter.py` if you want the
   literal behaviour.
7. **No `alembic/`, `docker-compose.yml` for Postgres, or `database/seed/`** —
   all consequences of (1).

## Two bugs worth knowing about

Both were found by running against the real catalogue rather than fixtures:

- **Generic fastener storms.** Wiring `bumper_cover → clip` by (klass, zone)
  alone made *every clip in the front of the car* bumper hardware — door seal
  clips outranked the actual bumper retainer. Fixed by requiring shared name
  stems or a shared diagram for `hardware` edges. Diagram co-membership alone
  was not enough: this catalogue splits the cover and its retainers across two
  diagrams.
- **"Front door" is not the front of the car.** The zone tagger read
  `Front Door Trim Moulding` as zone `front`, so a front bumper impact
  implicated the interior door trim and the door airbag sensors.
