"""Composes the four engines into one call. Still pure (spec 5.1).

    candidate_set -> propagate -> rank_inspections -> next_question -> split

`run` is what case_service calls on every new piece of evidence, and what the
confirm loop calls on every tick. Everything it needs is in its arguments; it
performs no I/O, so the whole prediction can be recomputed from scratch rather
than patched — which is what makes principle (1) affordable.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.engines import buckets, counterfactual, graph
from app.engines.history import EMPTY_HISTORY, History
from app.engines.types import Edge, Evidence, Inspection, Part, Prediction, Question


@dataclass(slots=True)
class Report:
    sections: buckets.Sections
    predictions: dict[str, Prediction]
    inspections: list[Inspection] = field(default_factory=list)
    question: Question | None = None
    candidates: int = 0
    computed_ms: int = 0


def run(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    history: History = EMPTY_HISTORY,
    conflicts: list[dict] | None = None,
    asked: frozenset[str] = frozenset(),
    rank_inspections: bool = True,
) -> Report:
    started = time.perf_counter()

    candidates = graph.candidate_set(parts, evidence)
    by_id = {part.part_id: part for part in candidates}

    # Narrow the edge list once, here, rather than in every sweep. The
    # counterfactual runs two propagations per ranked part; re-scanning all
    # ~21,000 catalogue edges each time is what blows the 400 ms budget.
    local_edges = [
        edge
        for edge in edges
        if edge.src_part_id in by_id and edge.dst_part_id in by_id
    ]

    predictions = graph.propagate(candidates, local_edges, evidence, history)

    inspections: list[Inspection] = []
    question: Question | None = None
    if rank_inspections:
        inspections = counterfactual.rank_inspections(
            candidates, local_edges, evidence, predictions, history
        )
        # The question is picked out of the inspection ranking, not recomputed:
        # `rank_inspections` has already scored exactly what a question needs
        # to know — how undecided each part is and how much settling it moves.
        question = counterfactual.next_question(
            candidates, local_edges, evidence, predictions, history, conflicts, asked,
            inspections,
        )

    # `split` needs the edges to fold fasteners under the part they belong to.
    # It gets the already-narrowed list, not the catalogue's ~21,000.
    sections = buckets.split(predictions, by_id, inspections, local_edges)
    elapsed = int((time.perf_counter() - started) * 1000)

    return Report(
        sections=sections,
        predictions=predictions,
        inspections=inspections,
        question=question,
        candidates=len(candidates),
        computed_ms=elapsed,
    )


def confirm(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    history: History = EMPTY_HISTORY,
) -> Report:
    """The tick/cross loop (spec 6.6): propagation only, no re-ranking.

    Budgeted at 150 ms round trip, so the counterfactual sweeps are skipped —
    the client is replacing its whole view, and re-ranking what to inspect next
    can wait for the next full run.
    """
    return run(parts, edges, evidence, history, rank_inspections=False)
