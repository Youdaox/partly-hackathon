# Claude Code task — Parts list must match the mockup: numbered cards + numerical "X% match"

Make the parts list look like the report mockup: each part is a card with a **numbered
circle**, a **bold part name**, a **numerical `X% match` badge** top-right, and a
**one-line reason** underneath — with the follow-up composer at the bottom. A recent "ui
rework" broke this by replacing the numerical badge with a High/Medium/Low chip. **Put
the numerical percentage back.**

Primary surface: **`apps/mobile/src/components/case-report.tsx`**. The components you need
already exist in **`apps/mobile/src/components/ui.tsx`** — use them, don't reinvent.

---

## Target design (from the mockup / screenshot)

```
Likely related parts
┌─────────────────────────────────────────────┐
│ (1)  Front Brake Pads              95% match │   ← filled badge (strong)
│ Pad wear sensor and remaining thickness are  │
│ both past the safety threshold on this side… │
├─────────────────────────────────────────────┤
│ (2)  Brake Rotors                  72% match │   ← outlined badge (medium)
│ Metal-on-metal contact this long usually…    │
├─────────────────────────────────────────────┤
│ (3)  Brake Fluid                   38% match │   ← quiet grey badge (weak)
│ Fluid is 3 years old with no flush on record…│
└─────────────────────────────────────────────┘
  Ask a follow-up…                          [↑]
```

Each row: numbered circle (left) · bold part name · **`{percent}% match`** badge (right)
· reason text below. The badge is **three-tier** (already implemented in `MatchBadge`):
≥75% filled, ≥50% outlined, <50% quiet grey — so 95% and 38% don't look equally urgent.

---

## The fix

1. **Use `MatchBadge` (numerical `X% match`), not `LikelihoodChip`.** In
   `case-report.tsx`, replace every `LikelihoodChip` with `MatchBadge` (the predicted /
   "you'll also need these" / check rows). `MatchBadge` already renders `{percent}% match`
   with the three tiers from the mockup — this is exactly the screenshot. Remove the
   `LikelihoodChip` import/usage from this list (leave the component defined if used
   elsewhere).

2. **Row layout = the mockup.** Each predicted-part card: `NumberBadge` (the numbered
   circle) + bold part name on the first line, `MatchBadge` pinned to the right of that
   line, then the `reason` line beneath. Demote the raw OEM part number to a small, muted
   secondary line (or drop it from the card face) — it must never out-weigh the name.

3. **Numbered, in order.** Number the cards 1, 2, 3… down the list (use `NumberBadge`),
   matching the screenshot.

4. **Keep the observed vs predicted rule.** Parts the camera/Partly actually saw
   (`sections.visible`, and anything confirmed) show **no** badge — they're facts, not
   predictions. The numerical `% match` badge appears **only** on the predicted / related
   parts (the screenshot's "Likely related parts"). This keeps the earlier decision and
   the mockup consistent.

5. **Follow-up composer** stays at the bottom (the "Ask a follow-up…" input) as in the
   screenshot — it already exists; just make sure it reads as part of this list's footer.

Keep the ✓/✗ confirm interaction and the "Why" attribution expander; they sit below the
reason as they do now.

---

## Constraints
- Reuse `MatchBadge`, `NumberBadge`, `Framed`/`Card`, theme tokens, and `ThemedText`.
  Same visual language as the rest of the app — this is matching an existing mockup, not
  a new design.
- Mobile React Native (Expo). If the web inspect parts list is also in use, apply the
  same numerical `X% match` treatment there so the two agree; otherwise mobile is the
  target.
- No new dependencies; don't change the backend contract.

## Acceptance
- Predicted parts render as numbered cards with a **numerical `X% match`** badge (95% /
  72% / 38%-style, three visual tiers), bold name, reason underneath — matching the
  screenshot.
- No High/Medium/Low text chip remains in the parts list.
- Visible/observed parts show no percentage.
- Part numbers are demoted below the name.
- `typecheck` / `lint` pass.

Start by reading `apps/mobile/src/components/case-report.tsx` (it currently imports
`LikelihoodChip`) and `apps/mobile/src/components/ui.tsx` (`MatchBadge`, `NumberBadge` are
already written to the mockup). Swap the chip for the badge and match the row layout.
