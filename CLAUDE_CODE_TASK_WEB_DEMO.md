# Claude Code task — Make the Expo app demo cleanly in a desktop browser at phone size

We are demoing the **existing Expo app (`apps/mobile`) in a browser on a Mac**, framed to
phone dimensions — not a native build, not the Next.js web app. `expo start --web`
already builds (app.json has `web.output: "static"`), but several pieces can break or
misrender on web, and the layout is tablet-wide. Harden it so the full demo flow runs in
Chrome, inside a phone-sized frame.

**Scope: `apps/mobile` web support + layout only. Don't change the backend or the
prediction logic. Don't touch `apps/web`.**

---

## 1. Phone-sized frame on web
When `Platform.OS === 'web'`, the app must present as a **single phone-width column**
(≈390–430px wide, full viewport height, centred) on a neutral page background, ideally
with a subtle device bezel/rounded frame — so on the Mac screen it reads as a phone, not a
full-width web page. Native (iOS/Android) layout must be unchanged.

- Do this once at the root (`app/_layout.tsx` or a small `WebFrame` wrapper around the
  navigator), not per-screen.
- Fix the wide hero: `src/components/rego-entry.tsx` (and any screen) currently uses
  `maxWidth: 720`; on web the content should sit inside the phone frame (~430px), not
  spread to 720.
- Scrolling, the docked composer, and modals must stay inside the phone frame.

## 2. Make it actually run on web (fix/guard the risky modules)
Go through these and ensure none crash the web build; guard or provide a web fallback:

- **react-native-reanimated 4 / react-native-worklets** — ensure the Babel config enables
  the worklets/reanimated plugin so web doesn't white-screen. There is currently **no
  `babel.config.js`**; add one using `babel-preset-expo` (which wires the plugin) if
  that's what's missing, and confirm animations run on web.
- **3D inspection (`@react-three/fiber` + `expo-gl` + `three`)** — the
  `VehicleViewer`/`InspectionViewerScreen` must render on web (react-three-fiber uses a
  standard WebGL canvas on web; `expo-gl`'s `GLView` is the native path). Make the viewer
  work on web, OR if GL isn't available, show a graceful fallback (e.g. a static
  labelled image / the damage list) instead of crashing. The 3D screen is part of the
  demo, so prefer making it work.
- **`expo-glass-effect`** (iOS-only "liquid glass") — guard any usage so it no-ops on web
  rather than throwing.
- **`expo-audio` voice capture** (`useVoiceCapture`) — mic may be unavailable on web;
  degrade gracefully (disable the mic button, no crash).
- **`expo-image-picker`** — on web this becomes a file input; verify photo add works in
  the browser so the "add photos" step functions in the demo.

## 3. Verify the whole demo flow in the browser
End to end in Chrome (device toolbar → iPhone), against `pnpm api` on :8080:
`rego entry → VIN fetch → catalogue loaded → add photos → interpreter/analysis beat →
visible vs predicted parts (numerical % match) → tick/cross re-ranks → 3D inspection`.
Everything renders inside the phone frame and nothing throws.

## Constraints
- `apps/mobile` only; reuse existing components/theme; no backend changes.
- Native builds must be unaffected (all web-specific behaviour behind `Platform.OS ===
  'web'` or web-only files).
- No new heavy dependencies.

## Acceptance
- `pnpm --filter @partli/mobile web` builds and loads with no console-fatal errors.
- On web the app renders as a centred phone-width frame (not full-width), on both the
  rego screen and the report.
- The full flow above works in the browser, including photos and the 3D inspection (or a
  clean fallback).
- Native layout/behaviour unchanged.
- `typecheck` / `lint` pass.

Start by running `pnpm --filter @partli/mobile web`, note what breaks in the console, then
fix the modules in §2 and add the §1 web frame. Read `app/_layout.tsx`,
`components/rego-entry.tsx`, `components/composer.tsx`, `screens/InspectionViewerScreen.tsx`,
and `components/VehicleViewer/*`.
