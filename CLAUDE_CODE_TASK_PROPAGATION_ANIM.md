# Claude Code task — Replace the "analysing" checklist with an animated damage-propagation graph

On the analysing/loading state (while the hidden-damage prediction runs), replace the
current multi-line stage checklist with **one animated graph icon** that visually shows
damage propagating through the parts graph — the point being to *show* what the engine is
doing. Mobile only (`apps/mobile`); demoed on Expo web too, so it must animate on web.

---

## What to replace
`src/components/damage-capture.tsx`, the `analysing` block (~line 305). Today it shows the
heading "Analysing the damage…" then a checklist of `BEATS`
("Storing… / Partly interpreter: reading the photos / Visible damage identified /
Our engine: propagating through the parts graph"). **Remove that checklist** and put a
single animated propagation graph in its place. Keep the "Analysing the damage…" heading
and the photo thumbnails; you may keep **one** short caption under the graph
(e.g. "Propagating through the parts graph…").

## The graphic (build a reusable component, e.g. `components/PropagationGraph.tsx`)
A small node-edge graph shaped like the reference icon: **4 round nodes joined by thick
straight segments, zig-zagging upward from the bottom-left to the top-right** (like a
rising line-chart trend). Positions roughly: node 1 bottom-left (lowest), node 2 up, node
3 a slight dip, node 4 top-right (highest). Draw it with **react-native-svg** (`Svg`,
`Line`/`Path`, `Circle`).

### The animation = damage propagating
Loop this continuously while `analysing`:
1. Start with all nodes/edges in a **neutral** colour (theme muted/border).
2. The **bottom-left node turns red** (damage origin) with a subtle pulse.
3. Damage **flows along edge 1** — animate the edge filling **red** from node 1 toward
   node 2 (e.g. a red stroke revealed via `strokeDashoffset`), then **node 2 turns red**.
4. Repeat along edge 2 → node 3, then edge 3 → **node 4 (top-right) turns red**.
5. Brief hold, then reset to neutral and repeat.

- Direction must read clearly **bottom-left → top-right**.
- "Red" = the theme's damage/danger colour; neutral = muted. Keep it clean, not garish.
- ~1.5–2s per full sweep, smooth, looping. Centre it; ~120–160px.
- Drive it with **react-native-reanimated** (`useSharedValue`, `withTiming`,
  `withSequence`, `withRepeat`) for node fill/opacity and edge reveal. Use
  `react-native-svg`'s animated components (or Reanimated `useAnimatedProps`) so it runs
  on the UI thread.

## Web (the demo runs on Expo web)
It must animate in the browser. Reanimated needs its Babel plugin configured for web (see
`CLAUDE_CODE_TASK_WEB_DEMO.md` §2); if animated SVG props don't work on
react-native-web, fall back to a lightweight equivalent (e.g. CSS/`Animated` or a
requestAnimationFrame loop) so the propagation still animates in the browser — never a
static image.

## Constraints
- `apps/mobile` only; reuse the theme (`constants/theme.ts`) and existing components. No
  new dependencies (svg + reanimated are already installed).
- Keep the `queued` ("waiting for the catalogue…") state working — you can show the same
  graph there, just keep it looping.
- Don't change the backend or the analysing timing/logic — only swap the visual.

## Acceptance
- The analysing state shows a single animated graph, not the stage checklist.
- Nodes/edges light up **red in sequence from bottom-left to top-right**, on a smooth
  loop, matching the reference shape.
- It animates in the browser (Expo web) and on native — not a static image.
- `typecheck` / `lint` pass.

Start by reading `src/components/damage-capture.tsx` (the `analysing` block and `BEATS`),
then build `PropagationGraph` and drop it in.
