"""In-memory state for vehicles and cases (spec 7.4, the non-Postgres variant).

Cases are the only mutable state in the system. They exist to carry
`observations` and `confirmations` across requests; everything else is either
derived from them or read-only catalogue data. Keyed by id, plain dicts, 24 h
TTL, no cross-case persistence.

Swapping this for the Postgres schema in spec 7 means replacing this module and
nothing else — services talk to these functions, never to a dict.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config import settings

_lock = threading.RLock()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20].upper()}"


@dataclass(slots=True)
class Vehicle:
    id: str
    rego: str
    status: str = "resolving"  # resolving|identified|catalogue_ready|not_found|no_catalogue
    slug: str | None = None
    vin: str | None = None
    make: str | None = None
    model: str | None = None
    year: int | None = None
    model_code: str | None = None
    market: str | None = None
    steering: str | None = None
    configuration: dict = field(default_factory=dict)
    parts_indexed: int = 0
    # Part-to-part connections built for this vehicle. The prediction is a walk
    # over these, so it is worth showing alongside the part count.
    edges_indexed: int = 0
    resolved_ms: int | None = None
    created_at: float = field(default_factory=time.time)


@dataclass(slots=True)
class Message:
    id: str
    case_id: str
    role: str  # repairer|assistant
    kind: str  # text|voice|image|video|question|report
    text: str | None = None
    transcript: str | None = None
    transcript_conf: float | None = None
    media_key: str | None = None
    meta: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


@dataclass(slots=True)
class MediaAsset:
    """One stored file. `id` is the stable media_id the client refers to.

    `filename` and `content_type` are what the repairer's device sent, kept
    verbatim so the app can show them exactly what they added — a derived
    asset (a keyframe, a demuxed audio track) has neither and carries a
    `parent_id` instead.
    """

    id: str
    case_id: str
    kind: str  # image|video|audio|frame
    storage_key: str
    message_id: str | None = None
    parent_id: str | None = None
    bytes: int = 0
    filename: str | None = None
    content_type: str | None = None
    uploaded_at: float = field(default_factory=time.time)
    processed_at: float | None = None


@dataclass(slots=True)
class Observation:
    """Append-only evidence (spec 7.4). Never updated, only added to."""

    id: str
    case_id: str
    p: float
    source: str  # interpreter|vision|speech|repairer
    part_id: str | None = None
    klass: str | None = None
    source_ref: str | None = None
    created_at: float = field(default_factory=time.time)


@dataclass(slots=True)
class Case:
    id: str
    vehicle_id: str
    status: str = "open"  # open|analysing|ready|ordered|closed
    zone: str = "front"
    side: str = "C"
    severity: int = 3
    severity_source: str = "default"
    exposed_depth: int = 0
    deadline: str | None = None
    messages: list[Message] = field(default_factory=list)
    media: list[MediaAsset] = field(default_factory=list)
    observations: list[Observation] = field(default_factory=list)
    confirmations: dict[str, bool] = field(default_factory=dict)
    conflicts: list[dict] = field(default_factory=list)
    # Klasses the repairer mentioned but was explicitly unsure about (spec 8.3),
    # mapped to the message that raised them. Worth asking about before anything
    # the graph merely inferred — and retractable when that message is edited.
    question_candidates: dict[str, str | None] = field(default_factory=dict)
    # Questions already answered this case — never re-asked (spec 9.5).
    questions_asked: set[str] = field(default_factory=set)
    impact_evidence: list[str] = field(default_factory=list)
    impact_confidence: float = 0.0
    last_report: dict[str, Any] | None = None
    order: dict[str, Any] | None = None
    # Customer approval. The token addresses the case from a public link, so it
    # is unguessable and is never the case id.
    approval_token: str | None = None
    approval_lines: list[dict] = field(default_factory=list)
    approved_option: str | None = None
    # Per-part decisions from the richer approval form; empty when a single
    # whole-quote option was picked instead.
    approved_picks: list[dict] = field(default_factory=list)
    approved_at: float | None = None
    analysing: set[str] = field(default_factory=set)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


_vehicles: dict[str, Vehicle] = {}
_vehicles_by_rego: dict[str, str] = {}
_cases: dict[str, Case] = {}
# media_id -> asset, so a thumbnail request does not scan every open case.
_media: dict[str, MediaAsset] = {}


# --- Vehicles ---------------------------------------------------------------

def create_vehicle(rego: str) -> Vehicle:
    with _lock:
        vehicle = Vehicle(id=new_id("veh"), rego=rego)
        _vehicles[vehicle.id] = vehicle
        _vehicles_by_rego[rego] = vehicle.id
        return vehicle


def get_vehicle(vehicle_id: str) -> Vehicle | None:
    with _lock:
        return _vehicles.get(vehicle_id)


def vehicle_by_rego(rego: str) -> Vehicle | None:
    with _lock:
        vehicle_id = _vehicles_by_rego.get(rego)
        return _vehicles.get(vehicle_id) if vehicle_id else None


# --- Cases ------------------------------------------------------------------

def create_case(vehicle_id: str) -> Case:
    with _lock:
        case = Case(id=new_id("case"), vehicle_id=vehicle_id)
        _cases[case.id] = case
        return case


def get_case(case_id: str) -> Case | None:
    _expire()
    with _lock:
        return _cases.get(case_id)


def recent_cases(limit: int = 50) -> list[Case]:
    _expire()
    with _lock:
        ordered = sorted(_cases.values(), key=lambda c: c.updated_at, reverse=True)
    return ordered[:limit]


def case_by_approval_token(token: str) -> Case | None:
    _expire()
    with _lock:
        return next((c for c in _cases.values() if c.approval_token == token), None)


def touch(case: Case) -> None:
    case.updated_at = time.time()


def add_message(case: Case, **kwargs: Any) -> Message:
    message = Message(id=new_id("msg"), case_id=case.id, **kwargs)
    with _lock:
        case.messages.append(message)
        touch(case)
    return message


def add_media(case: Case, **kwargs: Any) -> MediaAsset:
    asset = MediaAsset(id=new_id("med"), case_id=case.id, **kwargs)
    with _lock:
        case.media.append(asset)
        _media[asset.id] = asset
        touch(case)
    return asset


def get_media(media_id: str) -> MediaAsset | None:
    """One asset by its stable id, for serving the bytes back as a thumbnail."""
    with _lock:
        return _media.get(media_id)


def uploaded_media(case: Case) -> list[MediaAsset]:
    """What the repairer actually uploaded, oldest first.

    Keyframes and demuxed audio tracks are excluded: they are things this
    service made from an upload, not things anyone chose to send, and counting
    them would mean two photos came back as ten rows.
    """
    with _lock:
        assets = [asset for asset in case.media if asset.parent_id is None]
    return sorted(assets, key=lambda asset: asset.uploaded_at)


def add_observations(case: Case, observations: list[Observation]) -> None:
    with _lock:
        case.observations.extend(observations)
        touch(case)


def make_observation(case_id: str, **kwargs: Any) -> Observation:
    return Observation(id=new_id("obs"), case_id=case_id, **kwargs)


def set_confirmation(case: Case, part_id: str, damaged: bool | None) -> None:
    with _lock:
        if damaged is None:
            # Clears the tick/cross rather than recording a third state — the
            # engine already treats "no entry" as undecided (graph.py reads it
            # back with `.get(pid)`, defaulting to None), so this is the same
            # as the part never having been confirmed either way.
            case.confirmations.pop(part_id, None)
        else:
            case.confirmations[part_id] = damaged
        # Teardown that reveals a part proves everything above it is exposed.
        touch(case)


def _expire() -> None:
    """Drop cases past their TTL. Cheap enough to run on every read."""
    cutoff = time.time() - settings.case_ttl_hours * 3600
    with _lock:
        stale = [cid for cid, case in _cases.items() if case.updated_at < cutoff]
        for cid in stale:
            for asset in _cases[cid].media:
                _media.pop(asset.id, None)
            del _cases[cid]


def stats() -> dict:
    with _lock:
        return {"vehicles": len(_vehicles), "cases": len(_cases)}


def reset() -> None:
    """Test and demo-reset hook."""
    with _lock:
        _vehicles.clear()
        _vehicles_by_rego.clear()
        _cases.clear()
        _media.clear()
