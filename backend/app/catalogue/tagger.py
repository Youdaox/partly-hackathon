"""Raw Partly part record -> klass, zone, side, depth.

Everything downstream keys off `klass`, so this is where a catalogue of 7,009
undifferentiated assemblies becomes a graph. The rules live in
tables.klass_rules; this module only applies them, in order, and caches results
because the same display name recurs hundreds of times across a catalogue.
"""

from __future__ import annotations

import re
from functools import lru_cache

from app.tables.class_prior import leak_class_for
from app.tables.depth_map import DEPTH_MAP, UNKNOWN_DEPTH, UNKNOWN_KLASS
from app.tables.klass_rules import CENTRELINE_KLASSES, KLASS_RULES, SIDE_RULES, ZONE_RULES

_COMPILED_KLASS = [(re.compile(pattern, re.I), klass) for pattern, klass in KLASS_RULES]
_COMPILED_SIDE = [(re.compile(pattern, re.I), side) for pattern, side in SIDE_RULES]
_COMPILED_ZONE = [(re.compile(pattern, re.I), zone) for pattern, zone in ZONE_RULES]


@lru_cache(maxsize=32768)
def classify(name: str, std_note: str = "") -> str:
    """First matching rule wins. Order in KLASS_RULES is the specificity order."""
    haystack = f"{name} {std_note}".strip()
    if not haystack:
        return UNKNOWN_KLASS
    for pattern, klass in _COMPILED_KLASS:
        if pattern.search(haystack):
            return klass
    return UNKNOWN_KLASS


@lru_cache(maxsize=32768)
def side_of(name: str) -> str:
    for pattern, side in _COMPILED_SIDE:
        if pattern.search(name):
            return side
    return "C"


@lru_cache(maxsize=32768)
def zone_of(name: str, klass: str = "") -> str:
    for pattern, zone in _COMPILED_ZONE:
        if pattern.search(name):
            return zone
    # A few klasses are front-end by definition even when unqualified.
    if klass in {"radiator", "condenser", "cooling_fan", "radiator_support", "bonnet"}:
        return "front"
    return "other"


def depth_of(klass: str) -> int:
    return DEPTH_MAP.get(klass, UNKNOWN_DEPTH)


def tag(name: str, std_note: str | None = None) -> dict:
    """Full tag set for one part name."""
    note = std_note or ""
    klass = classify(name, note)
    side = side_of(name)
    if klass in CENTRELINE_KLASSES and side == "C":
        side = "C"
    return {
        "klass": klass,
        "side": side,
        "zone": zone_of(name, klass),
        "depth": depth_of(klass),
        "leak_class": leak_class_for(klass),
    }
