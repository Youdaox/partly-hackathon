"""Vision provider: frames -> impact descriptor + visible-damage observations.

This build has no VLM credentials, so `InterpreterVision` uses the strongest
vision signal the dataset actually ships: the Partly Interpreter output in
data/predictions/<slug>.json, which was itself produced from the frames in
data/damage-contexts/<slug>/. It is a genuine model result, just a pre-computed
one — which is also why it is honest to serve it on the `analysing` path.

For a vehicle with no Interpreter output the provider degrades to a class-level
descriptor rather than failing: no part ids, just a zone, a side and a severity.
"""

from __future__ import annotations

import asyncio

from app.ai.base import VisionObservation, VisionResult
from app.catalogue import interpreter, registry

PROMPT_VERSION = "vision-v1"

# Simulates the 3-8 s VLM latency of spec 4.2 so the `analysing` status and the
# SSE progress events are exercised. Short enough not to stall a demo.
SIMULATED_LATENCY_S = 1.2


class InterpreterVision:
    name = "interpreter"

    def __init__(self, latency_s: float = SIMULATED_LATENCY_S):
        self.latency_s = latency_s

    async def analyse(self, slug: str | None, frames: list[bytes]) -> VisionResult:
        if self.latency_s:
            await asyncio.sleep(self.latency_s)

        payload = registry.prediction_for(slug) if slug else None
        if payload is None:
            # No catalogue and no Interpreter output: still return something
            # usable. A front-corner default is the commonest presentation and
            # the repairer can correct it in one tap.
            return VisionResult(
                zone="front",
                side="C",
                severity=3,
                confidence=0.2,
                evidence=["no OEM catalogue for this vehicle; class-level estimate only"],
                provider=self.name,
            )

        parsed = interpreter.parse(payload)
        return VisionResult(
            zone=parsed.zone,
            side=parsed.side,
            severity=parsed.severity,
            confidence=parsed.confidence,
            evidence=parsed.evidence,
            conflicts=parsed.conflicts,
            observations=[
                VisionObservation(
                    part_id=part.part_id,
                    klass=None,
                    p=part.p,
                    label=part.name,
                    diagram_id=part.diagram_id,
                )
                for part in parsed.parts
            ]
            + [
                # No OEM part ids (matching still running): assert the class and
                # let evidence_service land it on real parts.
                VisionObservation(part_id=None, klass=klass, p=p, label=klass)
                for klass, p in parsed.klasses.items()
            ],
            provider=self.name,
        )


class VLMProvider:
    """Placeholder for a real vision-language model. Not wired up in this build."""

    name = "vlm"

    async def analyse(self, slug: str | None, frames: list[bytes]) -> VisionResult:
        raise NotImplementedError(
            "VLMProvider is a stub: this build has no model credentials. "
            "Implement analyse() and swap it in via app.api.deps."
        )
