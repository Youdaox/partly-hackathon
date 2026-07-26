"""What is worth finding out next (spec 9.5).

The layer that makes this an investigator rather than a predictor. Not a second
model: it calls engines.graph and measures how much the whole report moves
depending on the answer. Asking the repairer something is just a very cheap
inspection, so one mechanism drives both the inspection list and the assistant's
clarifying question.

For a part i, re-run propagation twice — clamped damaged and clean:

    own_i        = 2 · min(p_i, 1 − p_i)            # 1 at p=0.5, 0 when settled
    downstream_i = p_i·Σ|p_j^{i=1} − p_j| + (1−p_i)·Σ|p_j^{i=0} − p_j|
    value_i      = own_i + downstream_i
    accessible_i = depth_i ≤ exposed_depth + 2
    informs_i    = [ j : bucket(p_j^{i=1}) ≠ bucket(p_j^{i=0}) ]

Settled parts sink from *both* ends — a retainer at 0.978 and a firewall at
0.017 are equally not worth looking at. The accessibility flag stops the
assistant recommending an inspection that needs half a day of disassembly; it
sorts blocked parts after accessible ones rather than discounting their value,
because the information is still worth that much once the car is apart.

No prices, lead times or labour rates are used — none exist in the dataset. The
ranking answers "which check most changes what you order?", not "which saves
the most money."
"""

from __future__ import annotations

from dataclasses import replace

from app.engines.graph import propagate
from app.engines.history import EMPTY_HISTORY, History
from app.engines.physics import accessible
from app.engines.types import Edge, Evidence, Inspection, Part, Prediction, Question
from app.tables.constants import (
    ACCESSIBLE_MARGIN,
    CHECK_MIN,
    CONSUMABLE_KLASSES,
    ORDER_MIN,
    QUESTION_BAND_MAX,
    QUESTION_BAND_MIN,
    QUESTION_MIN_BUCKET_MOVES,
    QUESTION_MIN_DOWNSTREAM,
)


def _bucket(p: float) -> int:
    """Order / check / ignore, as an integer so comparisons are cheap."""
    if p >= ORDER_MIN:
        return 2
    if p >= CHECK_MIN:
        return 1
    return 0


def _with_confirmation(evidence: Evidence, part_id: str, damaged: bool) -> Evidence:
    confirmations = dict(evidence.confirmations)
    confirmations[part_id] = damaged
    return replace(evidence, confirmations=confirmations)


def rank_inspections(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    predictions: dict[str, Prediction],
    history: History = EMPTY_HISTORY,
    max_candidates: int = 40,
) -> list[Inspection]:
    """Rank parts by how much answering them changes the report.

    The pool is bounded by own-uncertainty before the expensive sweeps: settled
    parts have own ≈ 0 and downstream ≈ 0, so they cannot outrank anything in
    the top of the list — cutting them keeps 2×|pool| propagations inside the
    400 ms budget without changing the answer.
    """
    pool = [
        part
        for part in parts
        if part.part_id not in evidence.confirmations
        and part.part_id not in evidence.observations
    ]
    pool.sort(key=lambda part: -_own(predictions[part.part_id].p))
    pool = pool[:max_candidates]

    results: list[Inspection] = []
    for part in pool:
        pid = part.part_id
        p = predictions[pid].p

        if_damaged = propagate(parts, edges, _with_confirmation(evidence, pid, True), history)
        if_clean = propagate(parts, edges, _with_confirmation(evidence, pid, False), history)

        downstream = 0.0
        informs: list[str] = []
        for other, base in predictions.items():
            if other == pid:
                continue
            up = if_damaged.get(other)
            down = if_clean.get(other)
            if up is None or down is None:
                continue
            downstream += p * abs(up.p - base.p) + (1.0 - p) * abs(down.p - base.p)
            if _bucket(up.p) != _bucket(down.p):
                informs.append(other)

        own = _own(p)
        results.append(
            Inspection(
                part_id=pid,
                value=round(own + downstream, 4),
                own=round(own, 4),
                downstream=round(downstream, 4),
                accessible=accessible(part, evidence.exposed_depth, ACCESSIBLE_MARGIN),
                informs=informs,
            )
        )

    # Accessible first, then by value (spec 9.5).
    results.sort(key=lambda item: (not item.accessible, -item.value))
    for index, item in enumerate(results, start=1):
        item.rank = index
    return results


def _own(p: float) -> float:
    """1 at p = 0.5, 0 when settled either way (spec 9.5)."""
    return 2.0 * min(p, 1.0 - p)


# --- Clarifying questions ---------------------------------------------------

def next_question(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    predictions: dict[str, Prediction],
    history: History = EMPTY_HISTORY,
    conflicts: list[dict] | None = None,
    asked: frozenset[str] = frozenset(),
    inspections: list[Inspection] | None = None,
) -> Question | None:
    """At most one question, and only one the repairer can answer by looking.

    The old questions asked about the crash — whether the wheels ended up
    straight, whether the airbags fired, whether the door still shuts. He was
    not there. He is standing at the car in a shop, possibly days later, and
    being asked to reconstruct an event he never saw. They were also the same
    three every time, so they read as a form to fill in rather than as the
    assistant needing to know something.

    What replaces them is drawn from this case's own predictions: point him at
    one specific part he can reach, that the model is genuinely undecided
    about, and whose answer settles other parts too. If no part is all three,
    ask nothing — silence is better than a question with a good score and no
    consequence.

    `q_side` survives because it is not a crash question: the frames disagree
    about which corner, and which corner it is can be seen from where he
    stands.

    The ranking is `rank_inspections`' — passed in rather than recomputed,
    since the orchestrator has already paid for it.
    """
    by_id = {part.part_id: part for part in parts}

    # Side: asked when the frames disagree or nothing has settled it. Halves
    # the candidate set (spec 9.5) — the Yaris's own Interpreter output really
    # does caption one frame right and another left.
    side_conflict = any(c.get("field") == "side" for c in (conflicts or []))
    if "q_side" not in asked and (side_conflict or evidence.side in ("C", "", None)):
        left = propagate(parts, edges, replace(evidence, side="L"), history)
        right = propagate(parts, edges, replace(evidence, side="R"), history)
        changed = sum(
            1
            for pid in left.keys() & right.keys()
            if by_id[pid].klass not in CONSUMABLE_KLASSES
            and _bucket(left[pid].p) != _bucket(right[pid].p)
        )
        if changed >= QUESTION_MIN_BUCKET_MOVES:
            return Question(
                id="q_side",
                text="Which corner took the hit — right, left, or both?",
                options=["Right", "Left", "Both"],
                value=float(changed),
            )

    # Then: the most informative part he could go and look at right now.
    #
    # Tiered, because every vehicle must end up with a question and the three
    # differ enormously in what they can offer. The Santa Fe has parts whose
    # answer moves nine others; the Yaris's uncertain parts are all leaves that
    # settle only themselves; the E-Pace's light front knock leaves almost
    # nothing undecided at all. Insisting on the strongest tier gave two of the
    # three cars no question, so each tier relaxes exactly one requirement and
    # the reason for the ask is recorded on the Question.
    def eligible(item: Inspection) -> Part | None:
        part = by_id.get(item.part_id)
        prediction = predictions.get(item.part_id)
        if part is None or prediction is None:
            return None
        if f"q_check_{item.part_id}" in asked:
            return None
        # Reachable without taking the car apart further.
        if not item.accessible:
            return None
        # Nobody inspects a clip. Consumables are folded under their parent in
        # the report, so settling one changes nothing he can see.
        if part.klass in CONSUMABLE_KLASSES:
            return None
        return part

    pool = [item for item in (inspections or ()) if eligible(item) is not None]
    undecided = [
        item
        for item in pool
        if QUESTION_BAND_MIN <= predictions[item.part_id].p <= QUESTION_BAND_MAX
    ]

    # 1. Undecided *and* it settles other parts too — the question worth asking.
    informative = [i for i in undecided if i.downstream >= QUESTION_MIN_DOWNSTREAM]
    # 2. Undecided, but terminal: answering settles this part and no more. Still
    #    a real reduction in uncertainty, just a smaller one.
    # 3. Nothing sits in the undecided band at all, so take whatever is least
    #    settled. On a light impact this is the best that honestly exists.
    best = (
        max(informative, key=lambda i: i.downstream)
        if informative
        else max(undecided, key=lambda i: i.value)
        if undecided
        else max(pool, key=lambda i: i.own)
        if pool
        else None
    )

    if best is None:
        return None

    return Question(
        id=f"q_check_{best.part_id}",
        text=f"Take a look at the {by_id[best.part_id].name} — is it damaged?",
        options=["Damaged", "Looks fine", "Can't tell"],
        value=round(best.value, 4),
    )
