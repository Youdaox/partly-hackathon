"""Frames -> impact descriptor + visible-damage observations.

Owns no hidden-damage reasoning: it says what can be seen, and the prediction
engine works out what that implies (spec 4.1).
"""

from __future__ import annotations

from app.ai.base import VisionProvider, VisionResult
from app.store import cases
from app.store.cases import Case, Observation


async def analyse(
    provider: VisionProvider,
    case: Case,
    slug: str | None,
    frames: list[bytes],
) -> VisionResult:
    return await provider.analyse(slug, frames)


def apply(case: Case, result: VisionResult, source: str = "vision") -> list[Observation]:
    """Fold a vision result into the case: descriptor, conflicts, observations."""
    # Vision sets the descriptor only where the repairer has not already spoken.
    if case.severity_source in ("default", "vision"):
        case.zone = result.zone or case.zone
        case.side = result.side or case.side
        case.severity = result.severity or case.severity
        case.severity_source = "vision"

    if result.evidence:
        case.impact_evidence = result.evidence[:8]
    case.impact_confidence = result.confidence
    if result.conflicts:
        case.conflicts = result.conflicts

    observations = [
        cases.make_observation(
            case.id,
            part_id=observation.part_id,
            klass=observation.klass,
            p=observation.p,
            source=source,
        )
        for observation in result.observations
    ]
    cases.add_observations(case, observations)
    return observations
