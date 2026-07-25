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
pnpm db:up          # Postgres in Docker (optional — see "Running without Docker")
pnpm dev            # api :4000 + web :3000
pnpm mobile         # Expo, in a second terminal
```

Editing `packages/shared`? Run `pnpm dev:shared` in a third terminal to rebuild it on
save — the API picks the change up and restarts itself.

Then check it works end to end:

```bash
pnpm smoke          # drives the whole flow against the running API
```

You need Node 20+ and pnpm 11+. If you don't have pnpm: `npm install -g pnpm`.

### Running without Docker

If `DATABASE_URL` is unset the API falls back to **PGlite** — real Postgres 16 compiled to
WASM, stored in `apps/api/.pglite`. Same migration SQL, same queries, zero setup. This
exists so four people can work in parallel on day one without everyone fighting Docker.

Use real Postgres for the demo. `GET /health` reports which driver is live:

```json
{ "ok": true, "driver": "pglite" }
```

To switch to Docker Postgres, `pnpm db:up` and set `DATABASE_URL` in `apps/api/.env`
(copy from `.env.example`).

---

## What's where

```
apps/
  api/        Express + TypeScript. Jobs, the oracle, approvals.       :4000
  web/        Next.js 16 App Router, Tailwind v4, shadcn/ui.           :3000
  mobile/     Expo SDK 57 + expo-router. The repairer's capture app.
packages/
  shared/     Types + dataset parsing + the proximity graph. No framework deps.
data/         The Partly dataset (see docs/DATASET.md).
scripts/
  smoke.mjs   End-to-end check of every endpoint.
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
3. **Hidden damage** (mobile) — the oracle ranks parts likely damaged but not yet visible.
   Yes/No each one.
4. **Send to customer** (mobile) — builds the quote and shows a QR code.
5. **Approve** (web, `/approve/<jobId>`) — the customer picks OEM, aftermarket, or used.
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

## How the oracle works

The interesting part. Given the parts a repairer can see are damaged, which parts are
probably damaged behind them?

Two facts about the dataset shape the whole design (both verified in
`packages/shared/src/dataset/dataset.test.ts`):

1. A part's `hotspot` places it on **exactly one** diagram. Diagrams never share parts, so
   pixel distance only means something *within* a diagram.
2. `sub_assembly_ids` is therefore the **only** thing connecting one diagram to another.

So the proximity graph has two edge types:

- **spatial** — k-nearest neighbours by hotspot centre distance, within a diagram,
  normalised by that diagram's own spread so distances mean the same thing on a big
  engine-bay page and a small trim page.
- **assembly** — parent ↔ sub-assembly, which is what lets a score cross between diagrams.

Scoring runs a bounded Dijkstra from every visible-damage part and accumulates

```
contribution = seedWeight × baseRate(candidate) × exp(-decay × distance)
score        = 1 - exp(-Σ contributions)
```

so several independent damaged parts pointing at the same candidate reinforce each other,
and the result lands in 0..1. Seeds are weighted by the AI's severity call.

For the Yaris that's 6,960 nodes and ~53k edges, built in ~100 ms and cached per process.

> **Base rates are placeholders.** `BASE_RATES` in
> `packages/shared/src/dataset/proximity.ts` is a stand-in until the real seed base-rate
> table lands. Replace the contents of that map — the lookup function around it already
> works.

Sample output for the Yaris (front-end collision):

```
 92%  Front Bumper Fastener        Sits directly adjacent to Front Bumper Impact Absorber…
 91%  Front Bumper Splash Shield   Sits directly adjacent to Front Bumper Reinforcement…
 82%  Left Headlamp Assembly       Sits directly adjacent to Right Headlamp Assembly…
```

Confirming a prediction pins its confidence to 1 and promotes it onto the visible damage
list; denying pins it to 0. **Re-running the oracle never overwrites a human decision** —
it only replaces unreviewed predictions.

---

## API

Base URL `http://localhost:4000`.

| Method | Path | |
|---|---|---|
| `GET`  | `/health` | liveness + which DB driver is active |
| `GET`  | `/api/vehicles` | the demo fleet, catalogue vehicles first |
| `GET`  | `/api/vehicles/:slug/parts?q=` | resolve free text onto catalogue parts |
| `GET`  | `/api/vehicles/:slug/predictions` | the shipped AI prediction |
| `GET`  | `/api/vehicles/:slug/diagrams` | diagrams whose assets actually shipped |
| `GET`  | `/api/vehicles/:slug/diagrams/:id/segments` | polygons mapped to part ids |
| `GET`  | `/api/vehicles/:slug/diagrams/:id/image` | diagram artwork |
| `POST` | `/api/jobs` | create a job (`seedFromPrediction: true` to prefill) |
| `GET`  | `/api/jobs` | dashboard listing |
| `GET`  | `/api/jobs/:id` | job state: visible + hidden damage |
| `POST` | `/api/jobs/:id/damage` | add visible damage (`partId` or `rawText`) |
| `DELETE` | `/api/jobs/:id/damage/:damageId` | undo a mis-heard item |
| `POST` | `/api/jobs/:id/oracle/predict` | rank hidden damage, persist it |
| `POST` | `/api/jobs/:id/oracle/confirm` | repairer confirms/denies a prediction |
| `POST` | `/api/jobs/:id/send-to-customer` | build the quote, return a shareable link |
| `GET`  | `/api/approve/:jobId` | public: read the quote |
| `POST` | `/api/approve/:jobId` | public: submit the approved option |

---

## Database

Schema lives in `apps/api/migrations/001_init.sql` and is applied on every API boot
(everything is `IF NOT EXISTS`, so it's safe to re-run). To add a migration, drop a
`002_*.sql` next to it — they run in filename order.

`proximity_graph_cache` is **not** on the read path; the API builds graphs in memory. The
table exists so you can inspect the graph with SQL:

```bash
pnpm seed                    # all three catalogue vehicles
pnpm seed toyota-yaris-qmn16 # just one
```

---

## Dataset notes

Full details in [docs/DATASET.md](docs/DATASET.md). Things that will bite you:

- **Only three vehicles have a parts catalogue**: `toyota-yaris-qmn16`,
  `hyundai-santafe-pns53`, `jaguar-epace-rfh447`. The other five have a prediction but no
  `assemblies.json`, so the oracle can't run on them. The API returns a clear 400.
- **`hotspot` is a bounding box** (`x1,y1,x2,y2`), not a point. Use `hotspotCenter()`.
- **The catalogue references far more diagrams than ship with the bundle.** The Yaris names
  187 diagrams; only 50 have a folder on disk. Always check `hasDiagramAssets(slug, id)`
  before trying to render one.
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
| `pnpm test` | run the shared package's dataset tests |
| `pnpm smoke` | end-to-end API check against a running server |
| `pnpm seed` | precompute proximity graphs into Postgres |
| `pnpm db:up` / `db:down` / `db:reset` | docker-compose Postgres |

---

## Notes for the team

- **Phones can't reach `localhost`.** The mobile app defaults to the LAN IP that Metro is
  already serving from, which is the machine running the API. If that guess is wrong, set
  `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.
- **Voice transcription is the one real stub.** `apps/mobile/src/hooks/use-voice-capture.ts`
  handles permissions and recording and produces an audio file; `transcribe()` returns
  `null`. The text input next to it is the working path, and everything downstream already
  runs off that text. Wiring speech-to-text is a drop-in at that one function — do it via a
  new API endpoint so the key doesn't ship in the app bundle.
- **`packages/ui` was skipped.** It was optional, and mobile (React Native `StyleSheet`) and
  web (Tailwind v4 + shadcn) don't share a styling system, so a shared component package
  would have cost more than it returned. Mobile primitives are in
  `apps/mobile/src/components/ui.tsx`; web ones in `apps/web/components/ui/`.
- **The dataset API from the bundle isn't wired up.** `docker-compose.yml` still has the
  service, but behind a `dataset` profile because the `api/` image source was never
  committed. Nothing depends on it — `apps/api` reads `data/` directly.

See [LICENSE-NOTE.md](LICENSE-NOTE.md) — the dataset is Partly-owned and event-only.
