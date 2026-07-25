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

# --- Hedging ladder (spec 8.3) ---------------------------------------------
# Repairers signal certainty naturally and flattening it loses information, so
# the phrasing maps to four distinct confidences rather than a binary.
CERTAINTY_P = {
    "firm": 0.95,     # "the bumper's destroyed" / "the bumper's had it"
    "likely": 0.70,   # "the headlight's probably gone"
    "possible": 0.45,  # "I think there might be suspension damage"
    "unsure": 0.35,   # "not sure about the rail" -> also a question candidate
}
# The rung at which a mention is too weak to act on but worth asking about.
QUESTION_CANDIDATE_LEVEL = "unsure"

# Ordered most-hedged first: "I'm not sure it might be" should read as unsure,
# not as possible, so the weakest matching rung wins.
_HEDGE_LADDER: list[tuple[str, str]] = [
    (r"\bnot sure\b|\bno idea\b|\bcan'?t tell\b|\bhard to say\b|\bdunno\b", "unsure"),
    (r"\bi think\b|\bmight\b|\bmaybe\b|\bpossibly\b|\bcould be\b|\breckon\b", "possible"),
    (r"\bprobably\b|\blikely\b|\blooks like\b|\bseems\b|\bpretty sure\b", "likely"),
]

_NEGATIONS = re.compile(
    r"\b(no|not|nothing|didn'?t|doesn'?t|isn'?t|looks? (?:ok|fine|straight|alright))\b",
    re.I,
)
# "not sure" is a hedge, not a negation — it must not clear the component.
_NOT_A_NEGATION = re.compile(r"\bnot sure\b|\bnot certain\b", re.I)

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
    (
        r"smashed|shattered|torn off|ripped off|hanging off|detached|missing"
        # A repairer saying "big impact" or "the wheel's been removed" is
        # describing severity, not naming a part (spec 8.3's worked example).
        r"|big impact|heavy impact|taken a big|hit hard"
        r"|wheel (?:has been |been |was )?removed|wheel is off",
        3,
    ),
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
    (r"\brail\b|chassis leg|side member", "side_member"),
    (r"airbag", "airbag_module"),
]

# Deliberate teardown, not collision damage. "The wheel has been removed" tells
# you how deep they have got, not that the hub is broken, so it contributes a
# severity cue and an exposed-depth signal but no damage assertion.
_TEARDOWN = re.compile(r"\b(removed|taken off|stripped|unbolted|pulled off)\b", re.I)


@dataclass(slots=True)
class SpeechEvidence:
    zone: str | None = None
    side: str | None = None
    severity: int | None = None
    # klass -> probability, positive assertions only
    klasses: dict[str, float] = field(default_factory=dict)
    # klasses the repairer explicitly said were fine
    cleared: list[str] = field(default_factory=list)
    # klass -> certainty rung, so the UI can show how firmly each was asserted
    certainty: dict[str, str] = field(default_factory=dict)
    # Mentioned too vaguely to act on: "not sure about the rail". The
    # counterfactual engine should want to resolve these first (spec 8.3).
    question_candidates: list[str] = field(default_factory=list)
    severity_cues: list[str] = field(default_factory=list)
    # The repairer described stripping the car down, which tells the
    # counterfactual engine what is now reachable.
    teardown_mentioned: bool = False
    text: str = ""


async def transcribe(
    provider: ASRProvider,
    audio: bytes,
    mime: str,
    phrase_hints: list[str] | None = None,
) -> Transcript:
    """Transcribe, biasing the ASR towards this vehicle's vocabulary (spec 8.3)."""
    return await provider.transcribe(audio, mime, phrase_hints)


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
        match = re.search(pattern, lowered)
        if match:
            evidence.severity = rank
            evidence.severity_cues.append(match.group(0))
            break

    # Split on clause boundaries so a negation only clears its own clause:
    # "bumper's off but the wheel looks straight" must not clear the bumper.
    # Hedging is per-clause too: one hedged mention must not weaken a firm one
    # made in the same sentence.
    for clause in re.split(r",|\band\b|\bbut\b|\bthough\b|\.|;", lowered):
        clause = clause.strip()
        if not clause:
            continue

        level = _certainty_of(clause)
        negated = bool(_NEGATIONS.search(clause)) and not _NOT_A_NEGATION.search(clause)

        # Teardown language describes progress, not damage. Skip the assertion
        # but keep the cue.
        if _TEARDOWN.search(clause) and not negated:
            evidence.teardown_mentioned = True
            continue

        for pattern, klass in _SPOKEN_KLASS:
            if not re.search(pattern, clause):
                continue
            if negated:
                if klass not in evidence.cleared:
                    evidence.cleared.append(klass)
                evidence.klasses.pop(klass, None)
                evidence.certainty.pop(klass, None)
                continue

            p = CERTAINTY_P[level]
            if p >= evidence.klasses.get(klass, 0.0):
                evidence.klasses[klass] = p
                evidence.certainty[klass] = level
            if level == QUESTION_CANDIDATE_LEVEL and klass not in evidence.question_candidates:
                evidence.question_candidates.append(klass)

    # A part named by its catalogue term rather than workshop slang.
    fallback = classify(text)
    if (
        fallback != "unknown"
        and fallback not in evidence.klasses
        and fallback not in evidence.cleared
    ):
        evidence.klasses[fallback] = CERTAINTY_P["possible"]
        evidence.certainty[fallback] = "possible"

    return evidence


def _certainty_of(clause: str) -> str:
    """Weakest matching rung wins, so "I'm not sure it might be" reads as unsure."""
    for pattern, level in _HEDGE_LADDER:
        if re.search(pattern, clause):
            return level
    return "firm"
