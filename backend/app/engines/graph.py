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

Independence: the product over j is only meaningful when the j are separate
causes. A parts catalogue does not guarantee that — it lists a component once
per fitted position, so the same cause can arrive as nine edges. Incoming edges
are therefore grouped into channels keyed by (source klass, relation) and
discounted geometrically within a channel; see `propagate`.

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
from app.tables.constants import (
    MIN_EDGE_CONTRIBUTION,
    ROOT_SUPPORT_FULL,
    SOURCE_GROUP_DECAY,
)
from app.tables.depth_map import UNKNOWN_KLASS
from app.tables.reasons import DEFAULT_REASON, LEAK_CAUSE, REASONS, RELATION_REASON


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

    # How strongly the impact has actually been observed. The direct term is a
    # claim about damage nobody has looked at, so it is only worth making when
    # something *has* been looked at — see ROOT_SUPPORT_FULL.
    support = _root_support(evidence)

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
        lam_root = zone * g * prior_for(part.klass) * support

        survival = (1.0 - leak) * (1.0 - lam_root)
        log_terms: list[tuple[str, str, float]] = []
        if leak > 0:
            log_terms.append((LEAK_CAUSE, "leak", -math.log(1.0 - leak)))
        if lam_root > 0:
            log_terms.append(("direct impact", "root", -math.log(1.0 - lam_root)))

        # Edges are collected into evidential channels rather than multiplied
        # straight into the survival product. The noisy-OR is only valid when
        # its causes are independent, and catalogue rows are not: the Yaris
        # carries nine `bumper_cover` parts in the front zone (the cover, its
        # upper and lower halves, two extensions, two inserts, an assembly and
        # a lower reinforcement), all fed by one observation and one shared
        # root prior, each firing a hardware edge at λ = 0.90 into the same
        # retainer. Nine survivals of 0.145 make certainty out of one fact.
        #
        # Within a channel the strongest edge counts in full and each further
        # edge is discounted geometrically, so re-listing a cause adds a
        # little corroboration and never sums to proof. Between channels
        # nothing changes — a fender's `mounts` edge and a bumper cover's
        # `hardware` edge are independent and still multiply at full strength.
        channels: dict[tuple[str, str], list[tuple[float, str]]] = {}
        for edge in incoming.get(pid, ()):
            src = by_id[edge.src_part_id]
            p_src = probability.get(edge.src_part_id, 0.0)
            if p_src <= 0.0:
                continue
            lam = history.lambda_for(src.klass, part.klass, edge.relation)
            contribution = p_src * lam * g
            if contribution < MIN_EDGE_CONTRIBUTION:
                continue
            key = (src.klass, edge.relation)
            members = channels.get(key)
            if members is None:
                channels[key] = [(contribution, src.name)]
            else:
                members.append((contribution, src.name))

        for (_, relation), members in channels.items():
            if len(members) > 1:
                # Sorted on (contribution, name): ties break by name, so the
                # sweep is deterministic whatever order the edges arrived in.
                members.sort(reverse=True)
            decay = 1.0
            for contribution, name in members:
                damped = contribution * decay
                if damped < MIN_EDGE_CONTRIBUTION:
                    break  # the rest of the channel is weaker still
                survival *= 1.0 - damped
                log_terms.append((name, relation, -math.log(max(1e-12, 1.0 - damped))))
                decay *= SOURCE_GROUP_DECAY

        p = 1.0 - survival
        probability[pid] = p
        attribution = _attribute(log_terms)
        out[pid] = Prediction(
            part_id=pid,
            p=p,
            reason=_reason(part.klass, attribution),
            attribution=attribution,
            confirmed=None,
            observed=False,
        )

    return out


def _root_support(evidence: Evidence) -> float:
    """0..1: how confidently damage has actually been seen on this vehicle.

    Confirmations count as full support — a repairer standing at the car is
    better evidence than any camera. Otherwise it is the strongest observation
    the interpreter produced, clamped so anything at or above
    ROOT_SUPPORT_FULL behaves exactly as an ungated direct term did.
    """
    if any(evidence.confirmations.values()):
        return 1.0
    strongest = max(evidence.observations.values(), default=0.0)
    return min(1.0, strongest / ROOT_SUPPORT_FULL)


def _reason(klass: str, attribution: list[Cause]) -> str:
    """The line the repairer reads, taken from whatever actually drove the number.

    The attribution is already an exact decomposition of -log(1 - p), so its
    top term is not a guess about the cause — it *is* the cause. Naming it
    keeps the explanation and the arithmetic the same story: if the report says
    a bracket is there because of the right headlamp, the right headlamp is
    what put it there.
    """
    # A parent is named only when the parents are collectively most of the
    # story. Compared as a group rather than one at a time because the direct
    # term is a single number while the graph's contribution is spread over
    # several edges: a headlamp bracket sits at 42% direct and 58% across three
    # lamp edges, and "the impact reached it" is the wrong headline for that.
    # When the direct term really does dominate there is no parent to blame,
    # and the klass template is the honest answer.
    direct = 0.0
    best: Cause | None = None
    for cause in attribution:
        if cause.relation in ("leak", "root"):
            direct += cause.share
        elif best is None and cause.relation in RELATION_REASON:
            best = cause

    if best is not None and (1.0 - direct) >= direct:
        return RELATION_REASON[best.relation].format(cause=best.cause)
    return REASONS.get(klass, DEFAULT_REASON)


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
