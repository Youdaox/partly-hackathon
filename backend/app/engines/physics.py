"""Where damage can physically have reached, and whether a part is in its way.

Scope, stated honestly (spec 9.3): this is not a crash simulator, and nobody can
estimate velocity from a photograph. What it encodes is **structural ordering** —
a front end is engineered as a sequenced collapse (cover → absorber → beam →
crash box → rail → firewall), each stage designed to fail before the next. That
ordering is a design fact, stable across manufacturers, and it maps onto the
depth index in tables.depth_map.

Two pure functions of the part and the impact descriptor:

  depth_gate   could energy have reached this layer at all
  zone_factor  is this part in the corner that was hit

`depth_gate` belongs to the *target* part and multiplies every cause acting on
it — the direct term and every incoming edge (spec 9.3). `zone_factor`
multiplies only the direct term: left/right asymmetry needs no rule on the
edges, because the only route across the car is a transverse member, modelled
explicitly as a centre part.
"""

from __future__ import annotations

import math

from app.engines.types import Part
from app.tables.constants import DEFAULT_SEVERITY, REACH, SIGMOID_WIDTH, ZONE_FACTOR
from app.tables.klass_rules import CENTRELINE_KLASSES


def reach_for(severity: int) -> float:
    """Depth the impact is expected to have reached, on the 0..6 scale."""
    return REACH.get(severity, REACH[DEFAULT_SEVERITY])


def depth_gate(depth: int, severity: int) -> float:
    """Soft cutoff on depth: damage cannot appear at depth d unless energy
    reached depth d, regardless of what is destroyed in front of it.

    A sigmoid rather than a hard threshold because severity is itself an
    estimate. Gating only the direct term is a real bug (spec 9.3): observed
    parts clamp near 0.98 whatever the severity, so an ungated edge propagates
    a car-park scrape inward at full strength — 53% crash box at severity 1.
    """
    reach = reach_for(severity)
    return 1.0 / (1.0 + math.exp(-(reach - depth) / SIGMOID_WIDTH))


def zone_factor(part: Part, impact_zone: str, impact_side: str) -> float:
    """How much a part's location supports *direct* impact damage (spec 9.3).

    Returns 0.0 for parts outside the impact zone entirely — they can still be
    reached through edges, just never directly.
    """
    if part.zone != impact_zone or not part.zone or part.zone == "other":
        # front vs rear are not adjacent; we tag no adjacent zones today, so
        # anything outside the impact zone is elsewhere.
        return ZONE_FACTOR["elsewhere"]

    centred = part.side == "C" or part.klass in CENTRELINE_KLASSES
    if centred:
        return ZONE_FACTOR["centre"]

    if impact_side in ("both", "C", ""):
        return ZONE_FACTOR["same_side"]

    return ZONE_FACTOR["same_side"] if part.side == impact_side else ZONE_FACTOR["other_side"]


def accessible(part: Part, exposed_depth: int, margin: int) -> bool:
    """Can a repairer look at this part given how far teardown has got?"""
    return part.depth <= exposed_depth + margin
