"""The external model boundary. Everything behind a protocol (spec 5.1).

Nothing else in the codebase may call a model. Swapping the stub providers for
real Whisper and a real VLM means implementing these two protocols and changing
the wiring in app.api.deps — no service changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(slots=True)
class Transcript:
    text: str
    confidence: float = 0.0
    provider: str = "stub"


@dataclass(slots=True)
class VisionObservation:
    """One part the vision channel believes is damaged."""

    part_id: str | None
    klass: str | None
    p: float
    label: str
    diagram_id: str | None = None
    # spec 8.2: destroyed | detached | cracked | dented | scuffed | intact
    state: str | None = None
    # spec 8.2: high | low
    certainty: str | None = None


@dataclass(slots=True)
class VisionResult:
    zone: str = "front"
    side: str = "C"
    severity: int = 3
    confidence: float = 0.0
    evidence: list[str] = field(default_factory=list)
    observations: list[VisionObservation] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    # The two checks that move an assessment more than anything else (spec 8.2).
    # None means the frames did not settle it either way, which is different
    # from False and must not be reported as a negative finding.
    wheel_displaced: bool | None = None
    airbag_deployed: bool | None = None
    provider: str = "stub"


class ASRProvider(Protocol):
    async def transcribe(
        self, audio: bytes, mime: str, phrase_hints: list[str] | None = None
    ) -> Transcript: ...


class VisionProvider(Protocol):
    async def analyse(self, slug: str | None, frames: list[bytes]) -> VisionResult: ...
