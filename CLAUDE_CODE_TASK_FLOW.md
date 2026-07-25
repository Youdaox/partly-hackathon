# Claude Code task — MOBILE: two-screen flow, REGO entry → live damage analysis

**This is for the mobile app (`apps/mobile`, Expo / React Native). The demo runs on
mobile — do not touch the web app for this.** Restructure the existing home flow into the
exact two-screen experience below. The backend and the `backend.ts` client already work;
this is a **mobile UX/screen-structure** task, not new API wiring.

Keep the existing theme (`constants/theme.ts`), components (`components/ui.tsx`,
`ThemedText`, `Composer`), navigation (expo-router), and design language.

---

## What exists now (and why it's wrong for the demo)
`apps/mobile/src/app/index.tsx` is a single ChatGPT-style screen: a centred "What's going
on with the car?" greeting over a free-text `Composer`. The user **types** a description
that must contain the rego ("yaris front right hit"), submitting resolves the rego and
renders the report inline; photos are an optional "+" attachment. There is **no dedicated
rego screen and no photo-first analysis step** — which is the flow we want.

Note: this is a phone, so "drag photos" = **tap to add / take a photo** (`expo-image-picker`
is already wired in `pickMedia`). Keep that mechanism; just make it the centrepiece of a
dedicated analysis screen.

---

## The flow we want (build exactly this)

### Screen 1 — "Enter the rego" (the app's first screen)

**KEEP THE EXISTING CHAT AESTHETIC — do NOT build a plain form.** The home screen must
keep the current ChatGPT-style look: the centred greeting above the crop-marked
`Composer` (the pill input with the `+`, mic, and send button), with the suggestion rows
below. We are **repurposing that same composer as the rego entry**, not replacing it with
an input box and a "Look up vehicle" button. (A plain rego form is exactly what we don't
want.)

Changes to that hero:
- **Greeting** → make it ask for the rego, e.g. **"Enter the rego to start."** (replaces
  "What's going on with the car?").
- **Composer placeholder** → **"Enter the rego number (e.g. QMN16)"** (replaces "Describe
  the vehicle and damage"). The repairer types the rego into the same chatbox and hits
  send.
- **Suggestion rows** → make them rego-oriented: quick-pick chips/rows for the allowed
  demo regos (from `backend.listVehicles()` / `has_catalogue`, e.g. "QMN16 · Toyota
  Yaris"), plus keep "which vehicles can I assess?". Drop the "attach a photo / describe
  the symptom / trouble code" rows on this first screen — photos come on Screen 2.
- On submit, treat the composer's text as the **rego** and **advance immediately to
  Screen 2 — do NOT wait for the VIN.** `registerVehicle` returns right away with status
  `resolving`; kick the VIN → OEM-catalogue resolution off as a **background task** and
  move the user straight to the add-damage screen. There is **no blocking VIN loading
  screen.** The catalogue fetch is slow in reality (~minutes), so it must never gate the
  UI.
- The VIN/catalogue progress is surfaced as a **status line on Screen 2** (see §Background
  track), not as a gate.

Keep the composer as the input mechanism throughout (it becomes the follow-up input in
the report state, as it does today). Free-text "describe the damage" is no longer the
first prompt; if you want typed/voice notes, they belong on Screen 2 or as a follow-up —
not the rego screen.

### Screen 2 — "Add the damage" (SAME chatbox aesthetic as the rego screen)

**This page must look and work like the rego screen — same LLM-chatbox layout, same
`Composer`.** Do NOT use the big dashed drop-box. It mirrors Screen 1: a small vehicle
confirmation header, a greeting, then the identical composer.

- **Vehicle confirmation header** at the top: the resolved vehicle + catalogue, e.g.
  "✓ 2022 Hyundai Santa Fe · PNS53 · 10,781 parts loaded" (keep this).
- **Greeting**, mirroring how the rego screen says "Enter the rego": here it prompts the
  user to add the damage — e.g. **"Add the damage to start the analysis."**
- **The same `Composer` as the rego screen** — text field + `+` + mic + send arrow. The
  placeholder invites adding the damage, e.g. "Add crash photos, or describe the damage".
  Typed notes are optional evidence; the star action is the `+`.
- **The `+` opens an attach menu** offering **photos, a walkaround video, or take/capture
  a photo** (reuse/extend `pickMedia` / `expo-image-picker`; on web these are file
  pickers, on native the library + camera). Attached media appear as **thumbnails in/above
  the composer**, like attachments in an LLM chatbox.
- **Analysis starts on SEND** (the arrow), like sending a chat message — not
  automatically when a photo is attached. Pressing send with attachments (and/or text)
  runs the analysis. Under the hood: `uploadPhotos`/`attach` → `runPrediction` →
  `getReport`.
- **Send before the catalogue is ready → queue and auto-run.** The user can add photos and
  hit send while the OEM catalogue is still loading in the background. Accept the photos,
  show **"Analysing — waiting for the catalogue…"**, and **automatically run the
  prediction the instant the catalogue is ready** (`createCase`/`runPrediction` only work
  once the vehicle resolves). The user never has to press send twice.
- Present the run as the **Partly interpreter working on the photos**: a live, animated
  "Analysing photos… detecting visible damage…" beat (pretend, using the precomputed
  results — a second or two, not an instant flip), then reveal the report in place.
- Keep a subtle secondary **"Skip photos and predict now"** link for the case with no
  photos.
- **Report reveal**: the **visible damage Partly found**, then our engine's
  **hidden-damage predictions**, as two clearly distinct groups (observed vs predicted).
  Keep the ✓/✗ confirm loop (re-renders live), the one clarifying question if present, and
  the **3D inspection** and **Send to customer** links.

Reuse `CaseReportView` for the report and the shared `Composer` for input, so this screen
is visibly the rego screen's twin — just prompting for damage instead of a rego.

### Background track — VIN/catalogue loads while the user adds damage
The rego → VIN → OEM-catalogue resolution runs **in the background** the whole time the
user is on Screen 2 adding photos. It must never block the UI. Surface it as a **status
line pinned below** (below the composer / at the foot of the screen), stepping through
**stages**:

> Resolving VIN…  →  Loading OEM catalogue…  →  ✓ Catalogue ready (N parts)

- Use the existing parallel-track machinery: `registerVehicle` returns `resolving`
  immediately; poll with `waitForVehicleReady` / the vehicle-status endpoint in the
  background; the app already has a Track-A status pill (`vehicleStatusLine` in
  `case-report.tsx`) — reuse that concept as this status line.
- Show a tick when it lands. If it fails, show a clear error in the same line.
- **Demo timing:** keep the background load **quick (a few seconds)** but visibly a
  background process — the status line updates through the stages so the "you can start
  adding photos while it loads" story reads on stage. (Keep the simulated latency short;
  don't stall the demo.)
- The prediction can only fully run once the catalogue is ready — hence the queue-&-auto-run
  behaviour above. Everything else (adding/attaching photos, typing notes) works
  immediately, in parallel with the load.

---

## Feel / polish
- It must read as **two screens that change**, not one scrolling page. Screen 1 is calm
  and centred on the rego; Screen 2 is the working analysis view.
- Both "searching for VIN" and "interpreter analysing" are **live, animated beats** — a
  demo audience should see something happening.
- Keep provenance visible but subordinate (VIN → catalogue on Screen 1's reveal; a small
  vehicle confirmation on Screen 2).

## Constraints
- **`apps/mobile` only.** Reuse the existing `backend.ts` client, theme, components, and
  expo-router. No backend changes, no new heavy dependencies.
- **Backend reachability (blocks the demo):** the screenshot shows "Cannot reach the
  prediction backend — tried http://localhost:8080". On a physical phone, `localhost` is
  the phone, not the dev machine. `backend.ts` `resolveBaseUrl()` must resolve to the dev
  machine's LAN IP (e.g. via Expo's `hostUri`/`Constants.expoConfig` or an
  `EXPO_PUBLIC_API_URL` env), not hardcoded `localhost`. Make sure the app can reach the
  API from the device before relying on the live flow.
- Preserve existing capabilities: allowed-vehicle list, tracked photos, tick/cross
  re-propagate, clarifying question, 3D inspection link, recent-cases drawer, voice (moved
  off Screen 1 is fine).
- Don't regress `/case/[id]` deep links (they render `CaseReportView` too).

## Acceptance
- Launching the app shows the **rego entry first** — no free-text hero.
- Entering `QMN16` shows a live "Searching for VIN…" beat, then VIN + vehicle + catalogue
  loaded, then the app **changes** to the live damage-analysis screen.
- On Screen 2, adding photos triggers a live "interpreter analysing" beat, then reveals
  visible (Partly) vs hidden (predicted) parts; ✓/✗ still re-ranks live; 3D inspection
  link still works.
- It clearly feels like two different screens.
- `typecheck` / `lint` pass for `apps/mobile`.

Start by reading `apps/mobile/src/app/index.tsx`, `components/composer.tsx`,
`components/case-report.tsx`, `hooks/use-case.ts`, and `lib/backend.ts`. Reshape the
existing home flow into these two screens — do not rebuild the API layer or start from
scratch.
