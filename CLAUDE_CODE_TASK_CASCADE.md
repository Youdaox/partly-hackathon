# Claude Code task — Make the tick/cross cascade work on the predicted parts (the demo's key proof)

The "cross out a predicted part → the parts behind it drop and the list re-ranks" moment
is the strongest proof our engine is real, and **it currently cannot be triggered from the
UI.** Fix it. Mobile only (`apps/mobile/src/components/case-report.tsx`). The backend and
engine are correct — do not change them.

---

## Diagnosis (already confirmed — don't re-investigate)

- The engine **does** cascade. Crossing out "Front Bumper Reinforcement" as not-damaged
  drops its dependents (e.g. the chassis-rail braces) from ~0.615 → ~0.416 — enough to
  fall out of the order bucket. Confirmations re-propagate correctly via
  `case_service.confirm` → `repredict`, and `kase.confirm` already returns the fresh
  report and re-renders.
- **The problem is purely UI placement.** In `case-report.tsx` the ✓/✗ "Damaged / Not
  damaged" controls are rendered **only in the "Check on teardown" section**. Those are
  deep, terminal inspection items with no downstream, so crossing them changes nothing
  visible. The **"Hidden damage — what we predict"** hero (rendered by `HiddenRow`) — the
  predicted parts that actually have dependents — has **no confirm controls**, so the
  judge can't cross the one part that would cascade.

## The fix

1. **Add the ✓/✗ "Damaged / Not damaged" control to each hidden-damage prediction**
   (`HiddenRow` / the "Hidden damage — what we predict" section). Reuse the exact confirm
   markup already in the "Check on teardown" section (the `line.confirmed == null ? … :
   …` block with the two `Pressable`s calling `onConfirm(line.part_id, true/false)` and
   the "Confirmed damaged / Ruled out" settled state). `onConfirm` is already passed into
   `CaseReportView` — just wire it in `HiddenRow`.
2. **Keep the numerical `% match` badge on unconfirmed predictions**, and hide it once a
   part is confirmed/ruled out (the existing `line.confirmed == null ? <MatchBadge/> :
   null` pattern) — a settled part shows its state, not a percentage.
3. **Make the cascade visible — this matters, because the numeric change is modest.**
   Measured on the real engine, crossing a predicted parent drops its dependents by
   ~0.05–0.18 and moves only a couple across the order threshold. That's real but easy to
   miss, so the UI must make it obvious:
   - **Highlight/flash the rows whose probability changed** after a confirm (a brief
     accent background or a small ▼ with the delta, e.g. "0.62 → 0.42").
   - Parts that fall below the order threshold should **visibly move out of / down** the
     hidden section (animate the re-sort if cheap).
   - Optionally show a one-line confirmation of the cascade, e.g. **"3 parts re-ranked"**,
     so the judge registers that the tap moved the model.
   The point is that the judge *sees* the list respond to their tap, even when the
   underlying shift is a few points.

### Recommended demo parts (biggest visible cascade per vehicle — verified)
Pick the cross-out that shows best on stage:
- **Hyundai Santa Fe (`PNS53`) — "Left Headlamp Assembly"**: ruling it out drops **~9
  downstream parts** — the most dramatic cascade of the three vehicles. **Best demo.**
- **Toyota Yaris (`QMN16`) — "Right Front Guard Assembly"** (or a Headlamp Control
  Module): moves ~2 dependents out of the order bucket.
- **Jaguar E-Pace (`RFH447`)**: minor front impact, little to cascade — avoid for this
  beat.
Make sure whichever part is used for the demo actually carries the ✓/✗ control and that
its dependents visibly move.
4. Leave the **Visible damage** section without controls (those are observed facts), and
   the **Check on teardown** ✓/✗ can stay as-is.

## Why this is the right target
Crossing a *predicted parent* (e.g. the reinforcement bar) is the demo line — "watch what
happens to the parts behind it when I tell it this one's fine" — and only the hidden
predictions have parts behind them. Terminal check items don't, which is why it looks
broken today.

## Constraints
- `apps/mobile` only; reuse existing components/markup/theme. No backend or engine changes.
- Don't regress the check-section confirm or the visible section.

## Acceptance
- Every part in "Hidden damage — what we predict" has a working ✓/✗ control.
- Crossing out a predicted parent **visibly** lowers its dependents and re-ranks the
  hidden list — demonstrable on screen (changed rows highlight and/or reorder), not just
  in the data. Test with **Santa Fe `PNS53` → "Left Headlamp Assembly"** (≈9 dependents
  drop) as the clearest case, and confirm the Yaris works too.
- Confirming a part promotes it (to visible/settled); ruling one out removes it and drops
  its dependents. Both re-render live.
- The match badge disappears on a confirmed/ruled-out part.
- `typecheck` / `lint` pass.

Start by reading `apps/mobile/src/components/case-report.tsx` — compare the `HiddenRow`
component against the "Check on teardown" block that already has the ✓/✗ markup, and lift
that control into `HiddenRow`.
