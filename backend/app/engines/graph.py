"""Noisy-OR propagation over the component graph. The only place probabilities
are computed (spec 5.2).

For each part, the chance it needs replacing is the chance that *at least one*
of its causes carried damage into it:

    p_raw = 1 - (1 - leak * depth_gate) * PROD_e (1 - lambda_e * p_src)
    p     = min(class_prior * zone_factor * p_raw, cap)

The two gates enter in different places on purpose. `depth_gate` scales only the
leak term: it answers "did a collision this severe reach this layer unaided". It
must not scale the edge terms, because if the source part is already known to be
damaged then the energy demonstrably did get that far — a bumper cover lying on
the ground tells you its retainers are broken no matter what severity was
guessed. `zone_factor` scales everything, because a part on the far side of the
car is not involved regardless of how the damage got there.

`class_prior` is a ceiling: fully-supported parts converge on the rate at which
that class is actually replaced, not on 1.0.

Ordering is a single sweep over parts sorted by (depth, part_id). Any edge that
does not run forwards in that order is skipped, which makes the graph acyclic by
construction and the sweep O(V + E).
"""

from __future__ import annotations

import math
from collections import defaultdict

from app.engines.history import EMPTY_HISTORY, History
from app.engines.physics import depth_gate, zone_factor
from app.engines.types import Cause, Edge, Evidence, Part, Prediction
from app.tables.class_prior import leak_for, prior_for
from app.tables.constants import MAX_PROPAGATED_P, MIN_EDGE_CONTRIBUTION
from app.tables.reasons import DEFAULT_REASON, LEAK_CAUSE, REASONS

# Probability assigned to a part the repairer has confirmed by hand.
CONFIRMED_P = 1.0
REJECTED_P = 0.0
# Ceiling for a part with a direct observation, so nothing is ever exactly 1.
MAX_OBSERVED_P = 0.99


def _order_key(part: Part) -> tuple[int, str]:
    return (part.depth, part.part_id)


def propagate(
    parts: list[Part],
    edges: list[Edge],
    evidence: Evidence,
    history: History = EMPTY_HISTORY,
) -> dict[str, Prediction]:
    """One topological sweep. Pure: no I/O, no logging, no mutation of inputs."""
    by_id = {p.part_id: p for p in parts}
    order = sorted(parts, key=_order_key)
    rank = {p.part_id: i for i, p in enumerate(order)}

    incoming: dict[str, list[Edge]] = defaultdict(list)
    for edge in edges:
        src_rank = rank.get(edge.src_part_id)
        dst_rank = rank.get(edge.dst_part_id)
        if src_rank is None or dst_rank is None:
            continue
        # Forward edges only — guarantees acyclicity and a single sweep.
        if src_rank >= dst_rank:
            continue
        incoming[edge.dst_part_id].append(edge)

    out: dict[str, Prediction] = {}
    probability: dict[str, float] = {}

    for part in order:
        pid = part.part_id
        confirmed = evidence.confirmations.get(pid)

        if confirmed is not None:
            p = CONFIRMED_P if confirmed else REJECTED_P
            probability[pid] = p
            out[pid] = Prediction(
                part_id=pid,
                p=p,
                reason="confirmed by inspection" if confirmed else "inspected, not damaged",
                attribution=[Cause(cause="repairer confirmation", relation="confirmed", share=1.0)],
                confirmed=confirmed,
                observed=pid in evidence.observations,
            )
            continue

        zone = zone_factor(part, evidence.zone, evidence.side)
        gate = depth_gate(part.depth, evidence.severity)

        # --- noisy-OR terms, accumulated in log space for the attribution ----
        leak = leak_for(part.klass) * gate
        log_terms: list[tuple[str, str, float]] = []
        survival = 1.0 - leak
        if leak > 0:
            log_terms.append((LEAK_CAUSE, "leak", -math.log(max(1e-12, 1.0 - leak))))

        for edge in incoming[pid]:
            src = by_id[edge.src_part_id]
            p_src = probability.get(edge.src_part_id, 0.0)
            if p_src <= 0.0:
                continue
            lam = history.lambda_for(src.klass, part.klass, edge.relation)
            contribution = lam * p_src
            if contribution < MIN_EDGE_CONTRIBUTION:
                continue
            survival *= 1.0 - contribution
            log_terms.append((src.name, edge.relation, -math.log(max(1e-12, 1.0 - contribution))))

        p_raw = 1.0 - survival
        p = prior_for(part.klass) * zone * p_raw
        p = min(p, MAX_PROPAGATED_P)

        # A direct observation combines with the graph rather than replacing it:
        # a part both seen and structurally implied should beat either alone.
        observed_p = evidence.observations.get(pid)
        if observed_p is not None:
            p = 1.0 - (1.0 - observed_p) * (1.0 - p)
            p = min(p, MAX_OBSERVED_P)
            log_terms.append(("observed damage", "observation", -math.log(max(1e-12, 1.0 - observed_p))))

        probability[pid] = p
        out[pid] = Prediction(
            part_id=pid,
            p=p,
            reason=REASONS.get(part.klass, DEFAULT_REASON),
            attribution=_attribute(log_terms),
            confirmed=None,
            observed=observed_p is not None,
        )

    return out


def _attribute(log_terms: list[tuple[str, str, float]], limit: int = 4) -> list[Cause]:
    """Split credit between the causes that produced a probability.

    Exact for a noisy-OR: each term's contribution to -log(1 - p) is additive,
    so the shares are a genuine decomposition rather than a heuristic.
    """
    total = sum(weight for _, _, weight in log_terms)
    if total <= 0:
        return []
    ranked = sorted(log_terms, key=lambda t: t[2], reverse=True)[:limit]
    causes = [
        Cause(cause=name, relation=relation, share=round(weight / total, 4))
        for name, relation, weight in ranked
    ]
    return causes


def candidate_set(
    parts: list[Part],
    evidence: Evidence,
    limit: int = 400,
) -> list[Part]:
    """Narrow ~7,000 catalogue parts to the few hundred the impact could touch.

    Pure filtering on zone, side and depth. Keeps propagation inside its 20 ms
    budget (spec 4.2) without changing any answer: everything excluded here would
    score far below the reporting floor anyway.
    """
    reach_limit = evidence.severity + 2
    keep: list[tuple[float, Part]] = []

    for part in parts:
        if part.part_id in evidence.observations or part.part_id in evidence.confirmations:
            keep.append((1e9, part))  # never drop something we have evidence about
            continue
        zone = zone_factor(part, evidence.zone, evidence.side)
        if zone <= 0.05:
            continue
        if part.depth > reach_limit:
            continue
        gate = depth_gate(part.depth, evidence.severity)
        score = zone * gate * prior_for(part.klass)
        if score < 0.01:
            continue
        keep.append((score, part))

    keep.sort(key=lambda item: item[0], reverse=True)
    return [part for _, part in keep[:limit]]
