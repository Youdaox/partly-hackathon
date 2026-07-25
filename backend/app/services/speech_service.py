"""Audio -> transcript -> structured evidence.

Storing the audio is the media service's job; this module only interprets it.

Extraction is deliberately a keyword pass rather than another model call. What a
repairer says on a job is a small, closed vocabulary — a corner, a panel, a
severity, sometimes a negation — and a table of patterns is faster, free, and
debuggable. Anything it cannot parse simply produces no observation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.ai.base import ASRProvider, Transcript
from app.catalogue.tagger import classify

# Confidence assigned to a part class the repairer named out loud. High: they
# are standing in front of the car.
SPOKEN_P = 0.88
# Lower when the phrasing is hedged.
HEDGED_P = 0.55

_NEGATIONS = re.compile(
    r"\b(no|not|nothing|didn'?t|doesn'?t|isn'?t|looks? (?:ok|fine|straight|alright))\b",
    re.I,
)
_HEDGES = re.compile(r"\b(might|maybe|probably|think|possibly|looks like|reckon)\b", re.I)

_SEVERITY_PHRASES: list[tuple[str, int]] = [
    (r"write[- ]?off|caved in|folded|shunted hard|destroyed", 5),
    # Damage to the reinforcement beam is structural by definition, so it
    # outranks the word "bent" further down this list. "reo" is what a repairer
    # calls it.
    (
        r"pushed back|structure|chassis|rail|subframe|\breo\b|reinforcement"
        r"|crash bar|impact bar|airbag(s)? (went off|deployed)",
        4,
    ),
    (r"smashed|shattered|torn off|ripped off|hanging off|detached|missing", 3),
    (r"cracked|dented|bent", 2),
    (r"scuff|scratch|scrape|mark|paint", 1),
]

# Spoken phrase -> klass. Repairers do not say "bumper cover assembly".
_SPOKEN_KLASS: list[tuple[str, str]] = [
    (r"bumper|bar\b", "bumper_cover"),
    (r"head ?light|head ?lamp", "headlamp"),
    (r"tail ?light|tail ?lamp", "tail_lamp"),
    (r"fog ?light|fog ?lamp", "fog_lamp"),
    (r"grille|grill\b", "grille"),
    (r"bonnet|hood", "bonnet"),
    (r"guard|fender|wing\b", "fender"),
    (r"reo\b|reinforcement|crash bar|impact bar", "reinforcement_beam"),
    (r"rad(iator)?\b", "radiator"),
    (r"condenser", "condenser"),
    (r"slam panel|rad support|radiator support", "radiator_support"),
    (r"door", "door_panel"),
    (r"mirror", "mirror"),
    (r"windscreen|windshield", "windscreen"),
    (r"wheel|rim", "wheel_hub"),
    (r"suspension|control arm|strut", "suspension_arm"),
    (r"airbag", "airbag_module"),
]


@dataclass(slots=True)
class SpeechEvidence:
    zone: str | None = None
    side: str | None = None
    severity: int | None = None
    # klass -> probability, positive assertions only
    klasses: dict[str, float] = field(default_factory=dict)
    # klasses the repairer explicitly said were fine
    cleared: list[str] = field(default_factory=list)
    text: str = ""


async def transcribe(provider: ASRProvider, audio: bytes, mime: str) -> Transcript:
    return await provider.transcribe(audio, mime)


def extract(text: str) -> SpeechEvidence:
    """Transcript -> structured evidence. Pure and fast (spec 4.2: < 50 ms)."""
    evidence = SpeechEvidence(text=text)
    lowered = text.lower()

    if re.search(r"\bfront\b|bonnet|hood|headlight|headlamp|grille", lowered):
        evidence.zone = "front"
    elif re.search(r"\brear\b|boot|tailgate|tail ?light", lowered):
        evidence.zone = "rear"

    has_right = bool(re.search(r"\bright\b|\brh\b|passenger side", lowered))
    has_left = bool(re.search(r"\bleft\b|\blh\b|driver'?s? side", lowered))
    if has_right and has_left:
        evidence.side = "both"
    elif has_right:
        evidence.side = "R"
    elif has_left:
        evidence.side = "L"

    for pattern, rank in _SEVERITY_PHRASES:
        if re.search(pattern, lowered):
            evidence.severity = rank
            break

    hedged = bool(_HEDGES.search(lowered))

    # Split on clause boundaries so a negation only clears its own clause:
    # "bumper's off but the wheel looks straight" must not clear the bumper.
    for clause in re.split(r",|\band\b|\bbut\b|\bthough\b|\.|;", lowered):
        clause = clause.strip()
        if not clause:
            continue
        negated = bool(_NEGATIONS.search(clause))
        for pattern, klass in _SPOKEN_KLASS:
            if not re.search(pattern, clause):
                continue
            if negated:
                if klass not in evidence.cleared:
                    evidence.cleared.append(klass)
            else:
                p = HEDGED_P if hedged else SPOKEN_P
                evidence.klasses[klass] = max(evidence.klasses.get(klass, 0.0), p)

    # A part named by its catalogue term rather than workshop slang.
    fallback = classify(text)
    if fallback != "unknown" and fallback not in evidence.klasses:
        if fallback not in evidence.cleared:
            evidence.klasses[fallback] = HEDGED_P

    return evidence
