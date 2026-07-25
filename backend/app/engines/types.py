"""Plain data passed in and out of the engines.

Nothing here imports from services, models, ai or database. These are the only
types the prediction core knows about (spec 5.1).
"""

from __future__ import annotations

from dataclasses import dataclass, field

Relation = str  # mounts | hardware | load_path | adjacent | harness
Side = str  # L | R | C
Zone = str  # front | rear | left | right | other


@dataclass(frozen=True, slots=True)
class Part:
    part_id: str
    name: str
    klass: str
    depth: int
    zone: Zone
    side: Side
    part_number: str | None = None
    std_note: str | None = None
    leak_class: str = "default"
    is_orderable: bool = True
    quantity: int = 1
    diagram_id: str | None = None
    hotspot: tuple[int, int, int, int] | None = None


@dataclass(frozen=True, slots=True)
class Edge:
    src_part_id: str
    dst_part_id: str
    relation: Relation
    derived_from: str = "name_parse"


@dataclass(slots=True)
class Evidence:
    """Everything the engine knows about one case at one moment.

    `observations` are already merged across channels by evidence_service —
    the engine does not care whether a part was named by speech or by vision.
    """

    zone: Zone = "front"
    side: Side = "C"
    severity: int = 3
    # part_id -> probability asserted directly by an observation channel
    observations: dict[str, float] = field(default_factory=dict)
    # part_id -> True (damaged) | False (inspected, undamaged)
    confirmations: dict[str, bool] = field(default_factory=dict)
    # How far teardown has progressed; gates what is worth inspecting next.
    exposed_depth: int = 0


@dataclass(frozen=True, slots=True)
class Cause:
    """One term in the noisy-OR that produced a probability."""

    cause: str  # human-readable source part name, or "base rate"
    relation: Relation
    share: float


@dataclass(slots=True)
class Prediction:
    part_id: str
    p: float
    reason: str
    attribution: list[Cause] = field(default_factory=list)
    confirmed: bool | None = None
    observed: bool = False


@dataclass(slots=True)
class Inspection:
    """How much is learned by going and looking at one part (spec 9.5)."""

    part_id: str
    value: float
    own: float
    downstream: float
    accessible: bool
    # Parts whose bucket flips depending on this answer.
    informs: list[str] = field(default_factory=list)
    rank: int = 0


@dataclass(slots=True)
class Question:
    id: str
    text: str
    options: list[str]
    value: float
