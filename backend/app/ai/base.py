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


@dataclass(slots=True)
class VisionResult:
    zone: str = "front"
    side: str = "C"
    severity: int = 3
    confidence: float = 0.0
    evidence: list[str] = field(default_factory=list)
    observations: list[VisionObservation] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    provider: str = "stub"


class ASRProvider(Protocol):
    async def transcribe(self, audio: bytes, mime: str) -> Transcript: ...


class VisionProvider(Protocol):
    async def analyse(self, slug: str | None, frames: list[bytes]) -> VisionResult: ...
