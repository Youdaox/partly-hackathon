"""Partly Interpreter output -> impact descriptor + observations.

data/predictions/<slug>.json is the damage->parts result shipped with the
dataset. It is the strongest offline evidence available, so it is treated as its
own observation channel (`interpreter`) alongside speech and vision.

Shape:
  context_selection.completed.data.selected[]  frames + collision_context prose
  oem_parts.completed.data.oem_parts[]         raw part -> associated_oem_parts[]

Parsed at load and cached for the process lifetime (spec 4.3); the 50 ms budget
in spec 4.2 is for this function.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Interpreter confidence words -> probability.
CONFIDENCE_P = {"high": 0.92, "medium": 0.70, "low": 0.40}
# Interpreter severity words -> the 1..5 ladder.
SEVERITY_RANK = {"severe": 4, "major": 4, "moderate": 3, "minor": 2, "light": 1}
# Hardware kits are asserted much more weakly than the part they belong to.
HARDWARE_P = 0.55


@dataclass(slots=True)
class InterpreterPart:
    part_id: str
    name: str
    p: float
    diagram_id: str | None = None
    raw_part_name: str | None = None
    reason: str | None = None


@dataclass(slots=True)
class InterpreterResult:
    zone: str = "front"
    side: str = "C"
    severity: int = 3
    confidence: float = 0.0
    evidence: list[str] = field(default_factory=list)
    parts: list[InterpreterPart] = field(default_factory=list)
    # Class-level claims for vehicles whose OEM matching has not finished:
    # klass -> probability. Landed on real parts by evidence_service.
    klasses: dict[str, float] = field(default_factory=dict)
    conflicts: list[dict] = field(default_factory=list)
    # True when the oem_parts stage is still running (spec 6.9).
    in_progress: bool = False

    @property
    def available(self) -> bool:
        return bool(self.parts or self.klasses or self.evidence)


def _unwrap(node: dict | None) -> dict:
    """Every stage is wrapped in {"completed": {"data": {...}}}.

    A stage can also be {"in_progress": {...}}, which is not an error — the
    Jaguar ships exactly that for oem_parts — so callers must check
    `is_in_progress` rather than assuming an empty dict means no data.
    """
    if not isinstance(node, dict):
        return {}
    completed = node.get("completed") or {}
    data = completed.get("data")
    return data if isinstance(data, dict) else completed


def _is_in_progress(node: dict | None) -> bool:
    return isinstance(node, dict) and "in_progress" in node and "completed" not in node


def _side_of(text: str) -> str | None:
    lowered = text.lower()
    has_right = bool(re.search(r"\bright\b|\brh\b|passenger side", lowered))
    has_left = bool(re.search(r"\bleft\b|\blh\b|driver side", lowered))
    if has_right and has_left:
        return "both"
    if has_right:
        return "R"
    if has_left:
        return "L"
    return None


def _zone_of(text: str) -> str | None:
    lowered = text.lower()
    if re.search(r"\bfront\b|bonnet|headlamp|headlight|grille", lowered):
        return "front"
    if re.search(r"\brear\b|tailgate|boot\b|tail lamp", lowered):
        return "rear"
    return None


def _severity_of(text: str) -> int | None:
    lowered = text.lower()
    for word, rank in SEVERITY_RANK.items():
        if word in lowered:
            return rank
    return None


def parse(payload: dict) -> InterpreterResult:
    result = InterpreterResult()

    # --- impact descriptor from the frame commentary ------------------------
    selection = _unwrap(payload.get("context_selection"))
    frames = [f for f in (selection.get("selected") or []) if isinstance(f, dict)]

    side_votes: dict[str, list[str]] = {}
    zone_votes: list[str] = []
    severities: list[int] = []

    for index, frame in enumerate(frames):
        context = (frame.get("collision_context") or "").strip()
        if not context:
            continue
        if frame.get("is_collision_relevant") is False:
            continue
        result.evidence.append(context)

        side = _side_of(context)
        if side:
            label = frame.get("uri", f"frame {index:02d}").split("/")[-1]
            side_votes.setdefault(side, []).append(label)
        zone = _zone_of(context)
        if zone:
            zone_votes.append(zone)
        severity = _severity_of(context)
        if severity:
            severities.append(severity)

    if zone_votes:
        result.zone = max(set(zone_votes), key=zone_votes.count)
    if severities:
        result.severity = max(severities)

    # Frames genuinely disagree in this dataset — the Yaris has one frame calling
    # the damage right-hand and another calling it left. Surfacing that is what
    # gives the assistant something worth asking about (spec 6.5).
    single_sides = {s: refs for s, refs in side_votes.items() if s in ("L", "R")}
    if len(single_sides) > 1:
        detail = "; ".join(
            f"{refs[0]} reports {'right' if side == 'R' else 'left'}"
            for side, refs in single_sides.items()
        )
        result.conflicts.append(
            {"field": "side", "values": sorted(single_sides), "detail": detail}
        )
        result.side = "both"
    elif "both" in side_votes:
        result.side = "both"
    elif single_sides:
        result.side = next(iter(single_sides))

    # --- part observations --------------------------------------------------
    result.in_progress = _is_in_progress(payload.get("oem_parts"))
    oem = _unwrap(payload.get("oem_parts"))
    seen: set[str] = set()

    for entry in oem.get("oem_parts") or []:
        if not isinstance(entry, dict):
            continue
        raw_name = entry.get("raw_part_name")
        reason = entry.get("damage_reason") or entry.get("replacement_reason")
        base = CONFIDENCE_P.get(str(entry.get("confidence", "")).lower(), 0.6)

        for associated in entry.get("associated_oem_parts") or []:
            if not isinstance(associated, dict):
                continue
            part_id = associated.get("part_id")
            if not part_id or part_id in seen:
                continue
            seen.add(part_id)
            p = min(base, CONFIDENCE_P.get(str(associated.get("confidence", "")).lower(), 0.6))
            result.parts.append(
                InterpreterPart(
                    part_id=part_id,
                    name=associated.get("part_name") or raw_name or "",
                    p=p,
                    diagram_id=associated.get("diagram_id"),
                    raw_part_name=raw_name,
                    reason=reason,
                )
            )

            for hardware in associated.get("hardware_kit") or []:
                if not isinstance(hardware, dict):
                    continue
                hw_id = hardware.get("part_id")
                if not hw_id or hw_id in seen:
                    continue
                seen.add(hw_id)
                result.parts.append(
                    InterpreterPart(
                        part_id=hw_id,
                        name=hardware.get("part_name") or "",
                        p=HARDWARE_P,
                        diagram_id=hardware.get("diagram_id"),
                        raw_part_name=raw_name,
                        reason="hardware kit for " + (raw_name or "the part above"),
                    )
                )

    # --- fall back to raw part names ---------------------------------------
    # When OEM matching has not finished there are no part ids, but `raw_parts`
    # still names what is damaged. Classifying those names gives class-level
    # claims, which evidence_service lands on real catalogue parts. A report
    # built this way is weaker but it is not empty, which is the whole point of
    # degrading rather than failing.
    if not result.parts:
        result.klasses = _raw_klasses(payload)

    if result.parts:
        result.confidence = round(
            sum(p.p for p in result.parts) / len(result.parts), 3
        )
    elif result.klasses:
        result.confidence = round(
            sum(result.klasses.values()) / len(result.klasses) * 0.8, 3
        )

    return result


def _raw_klasses(payload: dict) -> dict[str, float]:
    """raw_parts.recommended_parts -> {klass: probability}."""
    from app.catalogue.tagger import classify

    raw = _unwrap(payload.get("raw_parts"))
    claims: dict[str, float] = {}

    for entry in raw.get("recommended_parts") or []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("raw_part_name")
        if not name:
            continue
        klass = classify(name)
        if klass == "unknown":
            continue
        # A class-level claim is inherently weaker than a matched part id.
        p = CONFIDENCE_P.get(str(entry.get("confidence", "")).lower(), 0.6) * 0.75
        claims[klass] = max(claims.get(klass, 0.0), round(p, 3))

    return claims
