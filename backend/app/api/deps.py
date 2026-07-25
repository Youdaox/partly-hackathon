"""Shared dependencies: current case, current vehicle, provider injection.

The two providers are constructed once here. Swapping `InterpreterVision` for a
real VLM, or `StubASR` for real Whisper, is a change to these two functions and
nothing else (spec 5.1).
"""

from __future__ import annotations

from functools import lru_cache

from app.ai.asr_whisper import StubASR
from app.ai.base import ASRProvider, VisionProvider
from app.ai.vision_vlm import InterpreterVision
from app.api.errors import ApiError
from app.store import cases
from app.store.cases import Case, Vehicle


@lru_cache
def get_vision() -> VisionProvider:
    return InterpreterVision()


@lru_cache
def get_asr() -> ASRProvider:
    return StubASR()


def require_case(case_id: str) -> Case:
    case = cases.get_case(case_id)
    if case is None:
        raise ApiError("case_not_found", f"no case {case_id}")
    return case


def require_vehicle(vehicle_id: str) -> Vehicle:
    vehicle = cases.get_vehicle(vehicle_id)
    if vehicle is None:
        raise ApiError("vehicle_not_found", f"no vehicle {vehicle_id}")
    return vehicle
