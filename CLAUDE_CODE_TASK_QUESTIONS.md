# Claude Code task — Replace the clarifying questions with observable, high-value ones

Backend task (`backend/app/engines/counterfactual.py` + `backend/app/api/v1/case.py`).
Redesign what the assistant asks the repairer. This supersedes the question logic in
`CLAUDE_CODE_TASK.md` §2D.

---

## The problem

The current questions are `q_wheels` ("Are the wheels sitting straight?"), `q_airbags`
("Did the airbags go off?"), `q_door` ("Does the driver's door still shut?"). They are
**wrong** for two reasons:

1. **They ask about the crash, which the repairer never saw.** He's standing at the car
   in the shop; he doesn't know what happened at impact. Asking him to reconstruct the
   event is useless.
2. **They're the same three boilerplate questions every time**, unrelated to this
   vehicle's actual damage — so they feel random and add no value.

## What we want instead

**One question, and only when it's worth it: point the repairer at a single specific part
he can look at right now, whose answer flips it from genuinely uncertain to certain.**

A good question:
- Is about **something observable on the car in front of him** — "look at this part, is it
  damaged?" — not about the crash, the history, or anything he'd have to have witnessed.
- Targets a part that is **genuinely uncertain** right now (a middling probability, not
  something already near-certain or near-zero).
- **Resolves real uncertainty**: answering it should promote that part (and the parts that
  depend on it) from a medium probability to a high/settled one, or rule it out.
- Is **specific to this case's damage**, chosen from the actual predictions — never a
  fixed boilerplate list.

---

## How to build it (reuse what's already there)

`rank_inspections` in `counterfactual.py` already scores every part by exactly this:
`value = own + downstream`, where `own = 2·min(p, 1−p)` peaks at p=0.5 (maximum
uncertainty) and `downstream` measures how much confirming it moves everything else. It
also flags `accessible` (the repairer can reach/see it now). Use that.

Rewrite `next_question` to:

1. **Candidate pool** = parts that are
   - not already observed or confirmed,
   - **observable now** (`accessible` — depth within reach given `exposed_depth`), and
   - in a **medium-uncertainty band** (roughly `0.35 ≤ p ≤ 0.70` — genuinely undecided;
     skip anything already high or already low, since asking there changes nothing).
2. **Rank** the pool by `value` (own uncertainty + downstream impact) from
   `rank_inspections`.
3. **Pick the single best** and phrase it as a direct observation the repairer makes at
   the car, e.g.:
   > "Take a look at the **{part name}** — is it damaged?"  · [Damaged] [Looks fine] [Can't tell]
4. **Only ask if it clears a real bar** — the top candidate must actually move the report
   (its `value` / downstream over a threshold). If nothing is both uncertain and
   observable and informative, **ask nothing**. Silence beats a filler question.
5. Answering it (`case.py` `post_answer`) **clamps that part** (Damaged → confirmed
   damaged, Looks fine → ruled out) via the existing confirmation path and re-propagates —
   so its probability and its dependents' probabilities move from medium to settled. Wire
   the new question id (e.g. `q_check_{part_id}`) to `case_service.confirm` /
   `confirm_klass`.

## Retire the crash questions

Remove `q_wheels` and `q_airbags` (and their `post_answer` branches) — they ask about the
crash event. `q_door` may stay **only** if reframed as a pure current observation tied to
a specific uncertain door/side part; otherwise remove it too. Keep `q_side` (which corner
is it) **only** when the frames genuinely conflict on side — that's a real, observable
disambiguation, not a crash question.

Do not reintroduce any question about how the crash happened, impact speed, angle, or
anything the repairer would have to have witnessed.

---

## Constraints
- Backend only; keep `next_question` pure and within the latency budget (it already
  bounds the pool before the expensive sweeps — keep that).
- At most one question per report, as now.
- Keep the answer→re-propagate wiring so answering visibly moves the list.

## Acceptance (add/extend tests in `backend/tests/`)
1. For the Yaris front-corner case, `next_question` does **not** return `q_wheels`,
   `q_airbags`, or `q_door`.
2. When it returns a question, the target part is (a) accessible, (b) in the medium band
   (~0.35–0.70), and (c) the highest-value such part.
3. Answering that question **Damaged** raises the part to settled-high and lifts its
   dependents; **Looks fine** drops it and its dependents (assert a real delta).
4. If no part is uncertain-and-observable-and-informative, `next_question` returns `None`
   (no filler question).
5. The question text references a specific catalogue part, not a fixed crash-event string.

Start by reading `counterfactual.py` (`rank_inspections`, `next_question`, `_own`,
`_bucket`) and `case.py` `post_answer`. Reuse the inspection scoring — don't build a
second ranker.
