"""What is worth going and looking at next.

Not a second model. This calls engines.graph and measures how much the whole
report moves depending on the answer (spec 5.2).

For a part i, the value of inspecting it is:

    own_i        = 2 * p_i * (1 - p_i)          how unsure we are about i itself
    downstream_i = E[ sum_j |p_j' - p_j| ]      how much the rest of the report moves
    value_i      = (own_i + downstream_i) * accessibility

The expectation is over the two answers, weighted by how likely each is:

    downstream_i = p_i * L1(clamp i = damaged) + (1 - p_i) * L1(clamp i = clean)

which is the `2 x |candidates|` sweeps of the performance budget (spec 4.2).
A part that is nearly certain either way scores near zero however deep it is:
there is no point sending someone to confirm what we already know.
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
    INACCESSIBLE_PENALTY,
    ORDER_THRESHOLD,
)


def _l1(base: dict[str, Prediction], other: dict[str, Prediction], skip: str) -> float:
    total = 0.0
    for pid, prediction in base.items():
        if pid == skip:
            continue
        moved = other.get(pid)
        if moved is not None:
            total += abs(moved.p - prediction.p)
    return total


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
    """Rank the uncertain parts by how much answering them changes the report."""
    # Only parts we are genuinely unsure about are worth a repairer's time.
    pool = [
        part
        for part in parts
        if part.part_id not in evidence.confirmations
        and CHECK_MIN * 0.5 <= predictions.get(part.part_id, _zero(part)).p < ORDER_THRESHOLD
    ]
    # Bound the work: 2 sweeps each, and the budget is 400 ms.
    pool.sort(key=lambda part: -_uncertainty(predictions[part.part_id].p))
    pool = pool[:max_candidates]

    results: list[Inspection] = []
    for part in pool:
        pid = part.part_id
        p = predictions[pid].p

        if_damaged = propagate(parts, edges, _with_confirmation(evidence, pid, True), history)
        if_clean = propagate(parts, edges, _with_confirmation(evidence, pid, False), history)

        downstream = p * _l1(predictions, if_damaged, pid) + (1.0 - p) * _l1(
            predictions, if_clean, pid
        )
        own = _uncertainty(p)
        reachable = accessible(part, evidence.exposed_depth, ACCESSIBLE_MARGIN)
        value = (own + downstream) * (1.0 if reachable else INACCESSIBLE_PENALTY)

        results.append(
            Inspection(
                part_id=pid,
                value=round(value, 4),
                own=round(own, 4),
                downstream=round(downstream, 4),
                accessible=reachable,
            )
        )

    results.sort(key=lambda item: item.value, reverse=True)
    for index, item in enumerate(results, start=1):
        item.rank = index
    return results


def _uncertainty(p: float) -> float:
    """Peaks at p = 0.5, zero at either certainty."""
    return 2.0 * p * (1.0 - p)


def _zero(part: Part) -> Prediction:
    return Prediction(part_id=part.part_id, p=0.0, reason="")


# --- Clarifying questions ---------------------------------------------------

def next_question(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    predictions: dict[str, Prediction],
    history: History = EMPTY_HISTORY,
    conflicts: list[dict] | None = None,
) -> Question | None:
    """The single question whose answer moves the report most.

    Same measure as an inspection, applied to the impact descriptor rather than
    to a part. Asked only when the answer is worth the interruption.
    """
    candidates: list[Question] = []

    side_conflict = any((c.get("field") == "side") for c in (conflicts or []))
    if evidence.side in ("C", "", None) or side_conflict:
        left = propagate(parts, edges, replace(evidence, side="L"), history)
        right = propagate(parts, edges, replace(evidence, side="R"), history)
        divergence = sum(
            abs(left[pid].p - right[pid].p) for pid in left.keys() & right.keys()
        )
        if divergence > 0.5:
            candidates.append(
                Question(
                    id="q_side",
                    text="Is the damage on the right corner, the left, or both?",
                    options=["Right", "Left", "Both"],
                    value=round(divergence, 4),
                )
            )

    # Severity is worth asking about when the report straddles a depth boundary.
    lower = propagate(parts, edges, replace(evidence, severity=max(1, evidence.severity - 1)), history)
    upper = propagate(parts, edges, replace(evidence, severity=min(5, evidence.severity + 1)), history)
    severity_divergence = sum(
        abs(lower[pid].p - upper[pid].p) for pid in lower.keys() & upper.keys()
    )
    if severity_divergence > 0.5:
        candidates.append(
            Question(
                id="q_severity",
                text="Did anything behind the bumper move, or is it just the outer skin?",
                options=["Just the skin", "Structure moved", "Not sure"],
                value=round(severity_divergence, 4),
            )
        )

    if not candidates:
        return None
    return max(candidates, key=lambda q: q.value)
