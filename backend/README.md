# Partli backend

Damage → hidden-parts prediction. FastAPI, implementing §4–§7 of SPEC.md.

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --port 8080     # docs at /docs
.venv/bin/python -m pytest -q                  # 103 tests, ~6 s
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

Noisy-OR over a component graph, one topological sweep by depth:

```
p_raw = 1 - (1 - leak · depth_gate) · Π (1 - λ_e · p_src)
p     = min(class_prior · zone_factor · p_raw, cap)
```

`depth_gate` scales only the leak term — it answers "did a collision this severe
reach this layer unaided". It must not scale the edge terms, because if the
source part is *known* damaged then the energy demonstrably got there: a bumper
cover on the ground tells you its retainers are broken whatever severity was
guessed. `zone_factor` scales everything, because a part on the far side of the
car is not involved however the damage arrived.

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

## Deviations from the spec

1. **In-memory case store, not Postgres.** Spec §7.4 sanctions this variant
   (24 h TTL, keyed by `case_id`). The Postgres schema in §7 is not implemented:
   no `models/`, no `database/`, no Alembic. Swapping it in means replacing
   `store/cases.py` — services never touch a dict directly.
2. **§9 reference numbers not asserted.** §9 was not supplied, so
   `test_engines.py` asserts the *properties* the spec states in prose
   (monotonicity, gating, decomposition, caps, clamp semantics) rather than
   fixed probabilities. The tables are ready for the reference values.
3. **§11.3 class-level degradation** was referenced but not supplied. The
   obvious reading is implemented: klass claims land on the parts of that class
   in the impact zone.
4. **Model providers are stubs.** No credentials in this build. `InterpreterVision`
   serves the shipped Partly Interpreter output — a genuine model result, just
   pre-computed. `StubASR` returns deterministic canned transcripts so the speech
   path is exercisable. Both sit behind the protocols in `ai/base.py`; swapping in
   real Whisper/VLM is a two-line change in `api/deps.py`.
5. **Speech extraction is a keyword pass, not a model call.** What a repairer
   says is a small closed vocabulary; a table is faster, free and debuggable.
6. **No `alembic/`, `docker-compose.yml` for Postgres, or `database/seed/`** —
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
