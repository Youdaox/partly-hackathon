"""Where damage can physically have reached, and whether a part is in its way.

Two gates, both pure functions of the part and the impact descriptor:

  depth_gate  did a collision of this severity get down to this layer at all
  zone_factor is this part in the corner that was hit

They are separate because they fail differently. A part can be shallow but on
the wrong side, or correctly located but far deeper than the impact reached.
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
    """Soft cutoff on depth.

    A sigmoid rather than a hard threshold because severity is itself an
    estimate: a severity-3 hit does not stop dead at depth 3, it becomes
    progressively less likely to have gone further.
    """
    reach = reach_for(severity)
    return 1.0 / (1.0 + math.exp(-(reach - depth) / SIGMOID_WIDTH))


def zone_factor(part: Part, impact_zone: str, impact_side: str) -> float:
    """How much a part's location agrees with where the vehicle was hit."""
    if part.zone == "other" or not part.zone:
        return ZONE_FACTOR["unknown"]

    if part.zone != impact_zone:
        return ZONE_FACTOR["zone_mismatch"]

    # Right zone. Now the side.
    if impact_side in ("both", "C", ""):
        return ZONE_FACTOR["match"]

    if part.side == "C" or part.klass in CENTRELINE_KLASSES:
        return ZONE_FACTOR["centre"]

    if part.side == impact_side:
        return ZONE_FACTOR["match"]

    return ZONE_FACTOR["side_mismatch"]


def gate_for(part: Part, evidence_zone: str, evidence_side: str, severity: int) -> float:
    """Combined location gate. Applied to a part's whole probability."""
    return zone_factor(part, evidence_zone, evidence_side)


def accessible(part: Part, exposed_depth: int, margin: int) -> bool:
    """Can a repairer look at this part given how far teardown has got?"""
    return part.depth <= exposed_depth + margin
