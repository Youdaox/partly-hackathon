"""Noisy-OR propagation over the component graph. The only place probabilities
are computed (spec 5.2). The formula is spec 9.2, verbatim:

    p_i = 1 − (1 − leak_i) · (1 − λ_root_i) · ∏_j (1 − p_j · λ_ji · g_i)

    where  λ_root_i = zone_factor_i · g_i · class_prior[klass_i]
           g_i      = depth_gate(depth_i, severity)

Three independent causes can put a part on the final order — it gets replaced
anyway (leak), the impact reached it directly (root), or something it is bolted
to is wrecked (parents). Any one is sufficient, so they combine as the chance
that none of them fired.

Placement of the gates is the part that must not be got wrong:

  - `g` belongs to the target and multiplies the direct term AND every edge
    (spec 9.3). Damage cannot appear at depth d unless energy reached depth d,
    regardless of what is destroyed in front of it.
  - `zone_factor` multiplies only the root term. Cross-car propagation flows
    through explicitly-modelled transverse members, not through a fudge factor.
  - `leak` is not gated at all: "replaced anyway" is invoice behaviour, not
    crash physics.

Edge semantics: λ = 0.8 means "A being wrecked, on its own, is enough to take
out B 80% of the time" — a causal power, NOT the observational P(B|A), which
bundles in every other cause of B and does not compose (spec 9.2, 9.4).

Ordering: edges always run low depth → high depth, so the graph is acyclic by
construction and topological order is `sort by depth`. Single pass, O(V+E).
"""

from __future__ import annotations

import math
from collections import defaultdict

from app.engines.history import EMPTY_HISTORY, History
from app.engines.physics import depth_gate, zone_factor
from app.engines.types import Cause, Edge, Evidence, Part, Prediction
from app.tables.class_prior import leak_for, prior_for
from app.tables.constants import MIN_EDGE_CONTRIBUTION
from app.tables.depth_map import UNKNOWN_KLASS
from app.tables.reasons import DEFAULT_REASON, LEAK_CAUSE, REASONS


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

        # Confirmations clamp hard: teardown ground truth outranks everything.
        confirmed = evidence.confirmations.get(pid)
        if confirmed is not None:
            p = 1.0 if confirmed else 0.0
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

        # Observed parts take the merged observation directly (spec 9.2's
        # pseudocode). The graph never argues with what a camera or a repairer
        # has actually seen.
        observed_p = evidence.observations.get(pid)
        if observed_p is not None:
            probability[pid] = observed_p
            out[pid] = Prediction(
                part_id=pid,
                p=observed_p,
                reason=REASONS.get(part.klass, DEFAULT_REASON),
                attribution=[Cause(cause="observed damage", relation="observation", share=1.0)],
                confirmed=None,
                observed=True,
            )
            continue

        g = depth_gate(part.depth, evidence.severity)
        zone = zone_factor(part, evidence.zone, evidence.side)

        # --- the three cause families, accumulated as survival --------------
        leak = leak_for(part.klass)
        lam_root = zone * g * prior_for(part.klass)

        survival = (1.0 - leak) * (1.0 - lam_root)
        log_terms: list[tuple[str, str, float]] = []
        if leak > 0:
            log_terms.append((LEAK_CAUSE, "leak", -math.log(1.0 - leak)))
        if lam_root > 0:
            log_terms.append(("direct impact", "root", -math.log(1.0 - lam_root)))

        for edge in incoming[pid]:
            src = by_id[edge.src_part_id]
            p_src = probability.get(edge.src_part_id, 0.0)
            if p_src <= 0.0:
                continue
            lam = history.lambda_for(src.klass, part.klass, edge.relation)
            contribution = p_src * lam * g
            if contribution < MIN_EDGE_CONTRIBUTION:
                continue
            survival *= 1.0 - contribution
            log_terms.append((src.name, edge.relation, -math.log(max(1e-12, 1.0 - contribution))))

        p = 1.0 - survival
        probability[pid] = p
        out[pid] = Prediction(
            part_id=pid,
            p=p,
            reason=REASONS.get(part.klass, DEFAULT_REASON),
            attribution=_attribute(log_terms),
            confirmed=None,
            observed=False,
        )

    return out


def _attribute(log_terms: list[tuple[str, str, float]], limit: int = 4) -> list[Cause]:
    """Split credit between the causes that produced a probability.

    Exact for a noisy-OR: each term's contribution to -log(1 - p) is additive,
    so the shares are a genuine decomposition — no SHAP, no surrogate model. It
    is the difference between a number a repairer argues with and one they
    ignore (spec 9.2).
    """
    total = sum(weight for _, _, weight in log_terms)
    if total <= 0:
        return []
    ranked = sorted(log_terms, key=lambda t: t[2], reverse=True)[:limit]
    return [
        Cause(cause=name, relation=relation, share=round(weight / total, 4))
        for name, relation, weight in ranked
    ]


def candidate_set(
    parts: list[Part],
    evidence: Evidence,
    limit: int = 400,
) -> list[Part]:
    """Zone filter first (spec 9.1): ~7,000 catalogue parts → the few hundred
    the impact could touch. Parts the tagger could not classify are excluded —
    an unknown part has no depth, no prior and no edges, so a probability for
    it would be an invention.
    """
    keep: list[tuple[float, Part]] = []

    for part in parts:
        if part.part_id in evidence.observations or part.part_id in evidence.confirmations:
            keep.append((1e9, part))  # never drop something we have evidence about
            continue
        if part.klass == UNKNOWN_KLASS:
            continue
        zone = zone_factor(part, evidence.zone, evidence.side)
        if zone <= 0.0:
            continue
        gate = depth_gate(part.depth, evidence.severity)
        keep.append((zone * gate * prior_for(part.klass), part))

    keep.sort(key=lambda item: item[0], reverse=True)
    return [part for _, part in keep[:limit]]
