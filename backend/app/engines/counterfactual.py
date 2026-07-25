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
    ORDER_MIN,
    QUESTION_MIN_BUCKET_MOVES,
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
) -> Question | None:
    """At most one question per case, and only when it clears the bar:
    at least QUESTION_MIN_BUCKET_MOVES parts change bucket depending on the
    answer, the repairer can answer it standing where they are, and no
    question has been asked already (spec 9.5).

    The highest-value questions are almost always severity discriminators,
    because severity moves the depth gate for every part at once.
    """
    candidates: list[Question] = []

    def moves(a: dict[str, Prediction], b: dict[str, Prediction]) -> tuple[int, float]:
        changed = 0
        shift = 0.0
        for pid in a.keys() & b.keys():
            shift += abs(a[pid].p - b[pid].p)
            if _bucket(a[pid].p) != _bucket(b[pid].p):
                changed += 1
        return changed, shift

    # Side: asked when the frames disagree or nothing has settled it. Halves
    # the candidate set (spec 9.5) — the Yaris's own Interpreter output really
    # does caption one frame right and another left.
    side_conflict = any(c.get("field") == "side" for c in (conflicts or []))
    if "q_side" not in asked and (side_conflict or evidence.side in ("C", "", None)):
        left = propagate(parts, edges, replace(evidence, side="L"), history)
        right = propagate(parts, edges, replace(evidence, side="R"), history)
        changed, shift = moves(left, right)
        if changed >= QUESTION_MIN_BUCKET_MOVES:
            candidates.append(
                Question(
                    id="q_side",
                    text="Is the damage on the right corner, the left, or both?",
                    options=["Right", "Left", "Both"],
                    value=round(shift, 4),
                )
            )

    # Severity discriminators, phrased as things a repairer can check from
    # where they stand (spec 9.3's ladder definitions).
    severity_questions = [
        ("q_wheels", "Are the wheels sitting straight?", ["Yes", "No", "Can't tell"], 3, 4),
        ("q_airbags", "Did the airbags go off?", ["No", "Yes"], 3, 4),
        ("q_door", "Does the driver's door still shut properly?", ["Yes", "No"], 4, 5),
    ]
    for qid, text, options, low, high in severity_questions:
        if qid in asked:
            continue
        # Only worth asking when the current estimate straddles the boundary.
        if not (low - 1 <= evidence.severity <= high):
            continue
        at_low = propagate(parts, edges, replace(evidence, severity=low), history)
        at_high = propagate(parts, edges, replace(evidence, severity=high), history)
        changed, shift = moves(at_low, at_high)
        if changed >= QUESTION_MIN_BUCKET_MOVES:
            candidates.append(Question(id=qid, text=text, options=options, value=round(shift, 4)))

    if not candidates:
        return None
    return max(candidates, key=lambda q: q.value)
