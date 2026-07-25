"""Merge the observation channels into the single Evidence the engine takes.

Channels are `interpreter`, `vision`, `speech` and `repairer`. They are merged
with a noisy-OR *across distinct sources only*: a part asserted by both speech
and vision should end up more confident than either alone (spec 7.4), but the
same channel repeating itself five times must not manufacture certainty, so
within a channel the strongest assertion wins.

Klass-level observations — "he said the headlight" — are spread over the parts
of that class that sit in the impact zone, which is also how the no-catalogue
path degrades (spec 11.3, referenced but not supplied; implemented here as the
obvious reading).
"""

from __future__ import annotations

from collections import defaultdict

from app.catalogue.registry import Catalogue
from app.engines.types import Evidence
from app.store.cases import Case

# Ceiling for merged observations. Nothing short of a confirmation is certain.
MAX_MERGED_P = 0.98
# A klass-level assertion is weaker than a part-level one, and gets weaker the
# more parts of that class are plausible targets.
KLASS_SPREAD_FLOOR = 0.25
MAX_KLASS_TARGETS = 6


def merge(case: Case, catalogue: Catalogue | None) -> Evidence:
    # part_id -> source -> best p from that source
    per_source: dict[str, dict[str, float]] = defaultdict(dict)
    klass_claims: dict[str, dict[str, float]] = defaultdict(dict)

    for observation in case.observations:
        if observation.part_id:
            bucket = per_source[observation.part_id]
            bucket[observation.source] = max(bucket.get(observation.source, 0.0), observation.p)
        elif observation.klass:
            bucket = klass_claims[observation.klass]
            bucket[observation.source] = max(bucket.get(observation.source, 0.0), observation.p)

    observations: dict[str, float] = {
        part_id: _combine(sources.values()) for part_id, sources in per_source.items()
    }

    # Klass claims land on real parts only when there is a catalogue to land on.
    if catalogue is not None:
        for klass, sources in klass_claims.items():
            p = _combine(sources.values())
            targets = _targets_for(catalogue, klass, case.zone, case.side)
            if not targets:
                continue
            # Spread the claim: naming a class is weaker evidence about any one
            # part than naming that part.
            share = max(KLASS_SPREAD_FLOOR, 1.0 / len(targets))
            for part in targets:
                spread = p * share
                observations[part.part_id] = max(observations.get(part.part_id, 0.0), spread)

    return Evidence(
        zone=case.zone,
        side=case.side,
        severity=case.severity,
        observations={pid: min(p, MAX_MERGED_P) for pid, p in observations.items()},
        confirmations=dict(case.confirmations),
        exposed_depth=case.exposed_depth,
    )


def _combine(values) -> float:
    """Noisy-OR across independent sources."""
    survival = 1.0
    for value in values:
        survival *= 1.0 - max(0.0, min(1.0, value))
    return 1.0 - survival


def _targets_for(catalogue: Catalogue, klass: str, zone: str, side: str) -> list:
    same_klass = [part for part in catalogue.parts if part.klass == klass]
    # Parts in the impact zone first. Unlocated parts are only considered when
    # nothing in the zone matches, otherwise "the moulding" on a front impact
    # picks up the door window mouldings, which are tagged `other`.
    matches = [part for part in same_klass if part.zone == zone]
    if not matches:
        matches = [part for part in same_klass if part.zone == "other"]
    if side in ("L", "R"):
        sided = [p for p in matches if p.side in (side, "C")]
        if sided:
            matches = sided
    # Prefer the shallowest, most orderable candidates — "the headlight" means
    # the assembly, not its bulb clip.
    matches.sort(key=lambda p: (p.depth, not p.is_orderable, p.name))
    return matches[:MAX_KLASS_TARGETS]


def apply_speech(case: Case, evidence) -> None:
    """Fold a SpeechEvidence into the case's impact descriptor.

    The repairer standing in front of the car outranks a frame classifier, so
    speech overwrites zone, side and severity rather than voting on them.
    """
    if evidence.zone:
        case.zone = evidence.zone
    if evidence.side:
        case.side = evidence.side
    if evidence.severity:
        case.severity = evidence.severity
        case.severity_source = "speech"
