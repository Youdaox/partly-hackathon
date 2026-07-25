# Partli

Automotive damage assessment. A repairer walks around a damaged car describing what they
see; Partli matches each part to the OEM catalogue, predicts what else is likely
damaged **behind** the panels, and sends the customer a quote they can approve from their
phone before the car is even stripped down.

Built for the Partly × WDCC Hackathon, 25–26 Jul 2026.

---

## Quick start

```bash
pnpm install
pnpm api:install    # one-off: Python venv for the backend
pnpm api            # backend on :8080  (docs at /docs)
pnpm dev            # web :3000, in a second terminal
pnpm mobile         # Expo, in a third
```

Editing `packages/shared`? Run `pnpm dev:shared` to rebuild it on save.

Then check it works end to end:

```bash
pnpm smoke          # drives the whole repairer journey against the running backend
pnpm api:test       # 172 backend tests
```

You need Node 20+, pnpm 11+ and Python 3.11+. If you don't have pnpm: `npm install -g pnpm`.

### No database to set up

There isn't one. Case state lives in memory with a 24 h TTL, and the catalogue is
read-only data on disk that is loaded and tagged at boot — the port is not bound
until that finishes, so nothing lazy-loads on the hot path.

`GET /healthz` reports what got indexed:

```json
{ "status": "ok", "vehicles_loaded": 3, "parts_indexed": 22644, "edges_indexed": 43738 }
```

`ffmpeg` is optional. Without it, video upload still works — it degrades to a
single keyframe and skips audio demux.

---

## What's where

```
backend/      FastAPI. The catalogue, the prediction engine, the API.  :8080
apps/
  web/        Next.js 16 App Router, Tailwind v4, shadcn/ui.           :3000
  mobile/     Expo SDK 57 + expo-router. The repairer's capture app.
packages/
  shared/     Types + vehicle matching + formatters. No framework deps.
data/         The Partly dataset (see docs/DATASET.md).
scripts/
  smoke.mjs   End-to-end check of the whole journey.
```

Each app has a `.env.example`. Copy it to `.env` (`.env.local` for web) — every value has
a working default, so you can skip this initially.

### `packages/shared` has two entrypoints

```ts
import type { Job, ApprovalOption } from '@partli/shared';        // safe everywhere
import { loadAssemblies, proximityGraph } from '@partli/shared/dataset';  // Node only
```

The root export is pure types and pricing helpers, so mobile and web can import it. The
`/dataset` export reads `data/` off disk with `node:fs` — **API and scripts only**. Keeping
them apart is what stops a React Native bundle trying to pull in `node:fs`.

---

## The demo flow

1. **Entry screen** (mobile) — one prompt box and nothing else. Type or say a sentence
   like *"yaris front right hit, bumper hanging off"* and you land in a live job: the
   vehicle is resolved, the job created, the damage recorded. Creating a job also seeds
   the visible damage list from the shipped AI prediction, so you start with real damage.

   There is no vehicle picker, so the sentence has to name the car. If it doesn't, the
   error names the vehicles that are available. The three with a catalogue are
   **Toyota Yaris**, **Hyundai Santa Fe** and **Jaguar E-Pace**.
2. **Live capture** (mobile) — keep describing damage. Each utterance is resolved against
   the OEM catalogue and appears in the list.
3. **Diagnosis** (mobile) — the report, in three sections: visible, order now, worth
   checking. ✓/✗ each uncertain part; the whole report recomputes in ~10 ms.
4. **Send to customer** (mobile) — builds the quote and shows a QR code.
5. **Approve** (web, `/approve/<token>`) — the customer picks OEM, aftermarket, or used.
6. **Front desk** (web, `/dashboard`) — every job and where it's got to.

---

## Turning speech into parts

Two pure functions in `packages/shared` do the work, both fully tested:

**`matchVehicle(text, vehicles)`** pulls the car out of a sentence and hands back what's
left as the damage description. A model hit outweighs a make hit, because three demo
vehicles are Toyotas. It normalises spelling, so `santa fe`, `santafe`, `e-pace` and
`epace` all land correctly, and it ignores the registration fragment in a slug so "16"
can't pick the Yaris.

**`searchParts(slug, query)`** resolves damage wording onto catalogue parts. Nobody says
"Left Headlamp Assembly" — they say "headlamp smashed". So it matches on *words*, and
weights each word by how rare it is across the catalogue (IDF). That matters more than it
sounds: without it, "front" (in hundreds of part names) drowns out "bumper", and
*"front right hit, bumper hanging off"* resolves to a footwell kick panel. On top of that:

- an exact phrase match still wins outright, so typing a real part name is precise
- parts that can't be ordered are pushed right down — they can't be quoted
- fasteners and trim are demoted unless you actually said "clip" or "bracket", because
  someone describing visible damage means the panel, not the clip holding it on
- duplicate display names are collapsed (the catalogue has several ids per physical part)

```
"headlamp smashed"                    -> Left Headlamp Assembly
"front right hit, bumper hanging off" -> Front Bumper Cover
"right guard scraped"                 -> Right Front Guard Panel
"completely destroyed"                -> nothing (no part named — better than a guess)
```

---

## How the prediction works

The interesting part. Given the parts a repairer can see are damaged, which parts
are probably damaged behind them?

A **noisy-OR over a component graph**, one topological sweep by depth:

```
p_raw = 1 - (1 - leak · depth_gate) · Π (1 - λ_e · p_src)
p     = min(class_prior · zone_factor · p_raw, cap)
```

Each catalogue part is tagged with a `klass` (~50 of them), a `depth` on a 0–6
scale from outer skin to subframe, a zone and a side. Edges between klasses carry
a λ — the chance damage propagates across that relation — resolved at request
time from an authored prior blended with repair history, so new history changes
predictions with no migration.

The two gates enter in different places on purpose. `depth_gate` scales only the
leak term: it answers "did a collision this severe reach this layer unaided". It
must *not* scale the edge terms, because if the source part is known damaged then
the energy demonstrably got there — a bumper cover on the ground tells you its
retainers are broken whatever severity was guessed. `zone_factor` scales
everything, because a part on the far side of the car is not involved however the
damage arrived.

Attribution is exact rather than heuristic: each term's contribution to
`-log(1 - p)` is additive, so the shares are a real decomposition.

**What to check next** is a separate engine that *calls* the graph rather than
being a second model. For each uncertain part it re-runs propagation clamped both
ways and measures how far the whole report moves:

```
value = own_uncertainty + E[ Σ|p' - p| ]
```

A part that is nearly certain either way scores near zero however deep it is —
there is no point sending someone to confirm what is already known.

The engine is pure: no DB, no network, enforced by a test that walks the AST for
banned imports. That is what makes it cheap enough to recompute the *entire*
report on every event instead of patching one, so a confirmation, a transcript and
a photo all take the same code path. Full run is ~250–390 ms including the
counterfactual; the ✓/✗ loop skips the ranking and lands in **9–12 ms**.

Sample output for the Yaris (front-right collision):

```
ORDER  0.854  Front Bumper Cover Retainer - Right Upper  snaps when the cover comes off
CHECK  0.553  Right Headlamp Housing                     in the impact zone and rarely survives it
       └─ 0.51 sub_assembly  Right Headlamp Assembly
          0.31 adjacent      Front Bumper Cover
```

Confirming a part clamps it to 1 and re-propagates; denying clamps it to 0, which
also cools everything downstream — something a plain delete could not do. Every
confirmation is applied as a full clamp set, never just the newest one.

---

## API

Base URL `http://localhost:8080`. Full interactive docs at `/docs`.

| Method | Path | |
|---|---|---|
| `GET`  | `/healthz` | liveness + what got indexed at boot |
| `POST` | `/v1/vehicle/register` | rego → start the VIN lookup |
| `GET`  | `/v1/vehicle/:id` | resolved vehicle + configuration |
| `GET`  | `/v1/vehicles` | the demo fleet |
| `POST` | `/v1/case` | open a case against a resolved vehicle |
| `GET`  | `/v1/cases` | front-desk / recent-jobs listing |
| `GET`  | `/v1/case/:id` | case + messages + current report |
| `GET`  | `/v1/case/:id/stream` | SSE: vehicle · transcript · analysis · report · question |
| `POST` | `/v1/case/:id/messages` | typed or spoken text |
| `PATCH`| `/v1/case/:id/messages/:mid` | correct a transcript; re-runs extraction |
| `POST` | `/v1/case/:id/answers` | answer the assistant's question |
| `POST` | `/v1/media/upload` | images or video (keyframes + audio demux) |
| `POST` | `/v1/audio/transcribe` | a voice note |
| `POST` | `/v1/damage/analyse` | force a re-analysis |
| `GET`  | `/v1/damage/report/:id` | visible layer + impact + frame conflicts |
| `GET`  | `/v1/prediction/results/:id` | **the report** |
| `POST` | `/v1/inspection/confirm` | ✓/✗ — returns a full replacement report |
| `GET`  | `/v1/parts/recommendations` | report joined with supplier offers |
| `POST` | `/v1/parts/finalise` | place the order |
| `POST` | `/v1/case/:id/send-to-customer` | build the quote, return a shareable link |
| `GET`  | `/v1/approve/:token` | public: read the quote |
| `POST` | `/v1/approve/:token` | public: submit the approved option |
| `GET`  | `/v1/vehicles/:slug/diagrams/:id/image` | diagram artwork (immutable) |

Errors use one envelope everywhere:

```json
{ "error": { "code": "rego_not_found", "message": "…", "retryable": false } }
```

The approval link is addressed by an unguessable token, not the case id — a
customer receives it by text and must not be able to walk it to another job.

---

## State

There is no database.

Cases are the only mutable state: they carry the observations and confirmations
that accumulate across requests, keyed by id in memory with a 24 h TTL. Everything
else is either derived from them or read-only catalogue data on disk.

That is the variant the spec sanctions for the MVP, and it is swappable — services
talk to `backend/app/store/cases.py`, never to a dict directly, so moving to
Postgres means replacing that one module.

The catalogue itself is loaded and tagged at boot for every vehicle on disk
(22,644 parts, 43,738 edges, ~0.9 s) **before** the port is bound. Tagging 7,009
parts takes ~260 ms, which would blow every latency budget if it happened inside a
request.

---

## Dataset notes

Full details in [docs/DATASET.md](docs/DATASET.md). Things that will bite you:

- **Only three vehicles have a parts catalogue**: `toyota-yaris-qmn16`,
  `hyundai-santafe-pns53`, `jaguar-epace-rfh447`. The other five have a prediction but no
  `assemblies.json`. Those degrade to class-level predictions rather than failing —
  `no_catalogue` is a success state, not an error.
- **The Jaguar's `oem_parts` stage is `in_progress`**, so it has no OEM part ids at
  all. Its `raw_parts` is complete, so the assistant falls back to class-level
  claims instead of showing an empty report.
- **`hotspot` is a bounding box** (`x1,y1,x2,y2`), not a point.
- **The catalogue references far more diagrams than ship with the bundle.** The Yaris names
  187 diagrams; only 50 have a folder on disk. Every report line carries
  `diagram_available` so the client never renders a hotspot over a 404.
- **No price, lead-time, stock or supplier field exists anywhere.** All commercial
  data is generated, and every response carrying it sets `"simulated": true`.
- **All 12 videos have an AAC audio track** with a narrating repairer, and Partly's
  own predictions leave `repairer_notes` empty almost everywhere. Uploading a video
  transcribes its audio automatically.
- **Everything is wrapped in a `completed` envelope**, and annotations are double-wrapped
  (`completed.annotation.objects`). `packages/shared` unwraps all of it for you.
- **Pricing is invented.** No supplier data ships with the dataset;
  `packages/shared/src/pricing.ts` derives stable pseudo-prices from the part id. Swap that
  module out wholesale when real pricing arrives.

---

## Commands

| | |
|---|---|
| `pnpm dev` | api + web |
| `pnpm dev:shared` | rebuild `packages/shared` on save |
| `pnpm mobile` | Expo dev server (needs its own terminal for the QR code) |
| `pnpm build` | build everything |
| `pnpm typecheck` | typecheck every workspace |
| `pnpm lint` | lint web + mobile |
| `pnpm test` | run the workspace tests |
| `pnpm api` | run the backend on :8080 |
| `pnpm api:install` | one-off: create the backend venv |
| `pnpm api:test` | 172 backend tests |
| `pnpm api:warm` | preload every catalogue and parse every prediction |
| `pnpm smoke` | end-to-end check against a running backend |

---

## Notes for the team

- **Phones can't reach `localhost`.** The mobile app defaults to the LAN IP that Metro is
  already serving from, which is the machine running the API. If that guess is wrong, set
  `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.
- **The model providers are stubs.** No credentials in this build. Vision serves the
  shipped Partly Interpreter output — a genuine model result, just pre-computed — and
  ASR returns deterministic canned transcripts. Both sit behind protocols in
  `backend/app/ai/base.py`; swapping in real Whisper/VLM is two lines in
  `backend/app/api/deps.py`, and the prompts are already written and versioned in
  `backend/app/ai/prompts/`.
- **ASR gets this vehicle's vocabulary.** Once the VIN resolves we hold ~7,000 part
  names for that exact car, so the ~200 most likely go to the ASR as phrase hints
  along with trade slang. "Slam panel" and "crash box" are not in a general model's
  comfortable vocabulary.
- **`packages/ui` was skipped.** It was optional, and mobile (React Native `StyleSheet`) and
  web (Tailwind v4 + shadcn) don't share a styling system, so a shared component package
  would have cost more than it returned. Mobile primitives are in
  `apps/mobile/src/components/ui.tsx`; web ones in `apps/web/components/ui/`.
- **`ffmpeg` is optional.** Without it, video upload degrades to a single keyframe
  and skips audio demux rather than failing.
- **The old TypeScript API is gone.** `apps/api` (Express + PGlite, keyed by
  `/api/jobs`) has been deleted; the backend is the FastAPI service in `backend/`,
  and both clients talk to `/v1`.

See [LICENSE-NOTE.md](LICENSE-NOTE.md) — the dataset is Partly-owned and event-only.
