"""Tagging, edge extraction and Interpreter parsing against the real dataset.

These run over data/vehicles/toyota-yaris-qmn16, so they fail loudly if the
shipped catalogue changes shape.
"""

from __future__ import annotations

import pytest

from app.catalogue import edges as edge_builder
from app.catalogue import interpreter, registry
from app.catalogue.tagger import classify, side_of, tag, zone_of
from app.tables.depth_map import DEPTH_MAP

SLUG = "toyota-yaris-qmn16"


@pytest.fixture(scope="module")
def catalogue():
    loaded = registry.ensure_loaded(SLUG)
    if loaded is None:
        pytest.skip(f"no catalogue for {SLUG}")
    return loaded


# --- tagging ----------------------------------------------------------------

@pytest.mark.parametrize(
    "name,expected",
    [
        # Ordering matters: the retainer must not be classified as the cover.
        ("Front Bumper Cover", "bumper_cover"),
        ("Front Bumper Cover Retainer - Right Upper", "cover_retainer"),
        # ...nor the bracket as the lamp it carries or the panel it bolts to.
        ("Radiator Support Headlamp Bracket - Right", "lamp_bracket"),
        ("Radiator Support Panel - Lower", "radiator_support"),
        ("Right Headlamp Assembly", "headlamp"),
        ("Front Bumper Reinforcement", "reinforcement_beam"),
        ("Front Bumper Impact Absorber", "bumper_absorber"),
        ("Front Bumper Splash Shield", "splash_shield"),
        ("Bonnet Panel", "bonnet"),
        ("Bonnet Hinge - Right", "bonnet_hinge"),
        ("Right Front Guard Liner", "fender_liner"),
        # A named fastener is a fastener first, whatever it fastens.
        ("Front Fender Liner Clip", "clip"),
        ("Radiator", "radiator"),
        ("Right Front Hub Carrier Upright", "steering_knuckle"),
        ("Right Front Suspension Control Arm - Lower", "suspension_arm"),
        # A generic bracket must not become a headlamp bracket.
        ("Flexible Hose Bracket Number 1", "bracket"),
    ],
)
def test_klass_rules_are_ordered_correctly(name, expected):
    assert classify(name) == expected


def test_gate_five_named_parts_classify_exactly():
    """The §12.1 gate: five real Yaris part numbers (found via hotspot.code,
    verified present in the shipped catalogue), each with an exact expected
    klass and depth. If this fails, every downstream number "looks plausible
    and is wrong" — the spec's own words for why this runs before anything else.

    Two of these caught real ordering bugs when first checked against the real
    catalogue rather than a hand-picked fixture:
      - "Right Headlight Wiring Harness" matched `headlamp` before `harness`,
        because the lighting rules ran before the wire/wiring-harness rule.
        A lamp's wire is not the lamp.
      - "Front Bumper Reinforcement Brace" matched the generic reinforcement
        rule instead of `crash_box`, despite its own std_note reading "BRACKET
        SUB-ASSY, FRONT SIDE MEMBER" — it is the load-transfer bracket between
        the beam and the rail, not the beam itself.
    """
    gate = [
        ("Front Bumper Cover Retainer - Right Upper", "52535", "cover_retainer", 1),
        ("Front Bumper Impact Absorber", "52611", "bumper_absorber", 2),
        ("Radiator Support Headlamp Bracket - Right", "52143K", "lamp_bracket", 3),
        ("Right Headlight Wiring Harness", "81125", "harness", 3),
        ("Front Bumper Reinforcement Brace - Right", "57013D", "crash_box", 4),
    ]
    for name, part_number, expected_klass, expected_depth in gate:
        got_klass = classify(name)
        assert got_klass == expected_klass, f"{name!r} (part {part_number}): got {got_klass}"
        assert DEPTH_MAP[got_klass] == expected_depth, (
            f"{name!r} (part {part_number}): depth {DEPTH_MAP[got_klass]} != {expected_depth}"
        )


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Right Front Axle Hub", "R"),
        ("Bonnet Hinge - Left", "L"),
        ("Front Bumper Cover Retainer - Right Upper", "R"),
        ("Front Bumper Cover", "C"),
    ],
)
def test_side_detection_handles_prefix_and_suffix(name, expected):
    assert side_of(name) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Front Bumper Cover", "front"),
        ("Rear Bumper Cover", "rear"),
        ("Cylinder Head Sub-Assembly", "other"),
        # "Front door" is not the front of the car.
        ("Right Front Door Trim Moulding - Interior", "other"),
        ("Left Front Door Air Bag Impact Sensor", "other"),
        # "Headlight" and "headlamp" are used interchangeably in this
        # catalogue — 43 Yaris parts say "headlight" and none matched the zone
        # rule before it included that spelling. A part zoned "other" gets
        # zone_factor 0 (physics.py) and is silently dropped from every
        # candidate set, at any severity — not a scoring error, an erasure.
        ("Right Headlight Wiring Harness", "front"),
        ("Automatic Headlight Sensor Wiring Harness", "front"),
        ("Fog Light Cut-Off Relay", "front"),
    ],
)
def test_zone_detection(name, expected):
    assert zone_of(name) == expected


def test_tag_returns_a_complete_record():
    tagged = tag("Front Bumper Cover Retainer - Right Upper")
    assert tagged == {
        "klass": "cover_retainer",
        "side": "R",
        "zone": "front",
        # Depth 1 per the 9.3 reference table: the retainer is destroyed the
        # moment the cover moves, so it sits with the cover, not behind it.
        "depth": 1,
        "leak_class": "consumable",
    }


# --- loading ----------------------------------------------------------------

def test_yaris_indexes_every_assembly(catalogue):
    assert catalogue.parts_indexed == 7009, "spec 6.2 quotes 7,009 parts for QMN16"


def test_sparse_fields_are_carried_as_none_not_defaulted(catalogue):
    """Only 3,563 of 7,009 parts have a hotspot; the API must be able to say so."""
    without_hotspot = [p for p in catalogue.parts if p.hotspot is None]
    without_number = [p for p in catalogue.parts if p.part_number is None]
    assert without_hotspot and without_number


def test_load_is_fast_enough_to_preload(catalogue):
    assert catalogue.load_ms < 3000


# --- edges ------------------------------------------------------------------

def test_cover_reaches_its_own_retainers(catalogue):
    cover = next(p for p in catalogue.parts if p.name == "Front Bumper Cover")
    retainers = {
        p.part_id for p in catalogue.parts
        if p.klass == "cover_retainer" and p.zone == "front"
    }
    reached = {
        e.dst_part_id for e in catalogue.edges
        if e.src_part_id == cover.part_id and e.relation == "hardware"
    }
    assert reached & retainers, "the bumper cover must reach its retainers"


def test_cover_does_not_reach_unrelated_fasteners(catalogue):
    """The failure this rule exists to prevent: door clips as bumper hardware."""
    cover = next(p for p in catalogue.parts if p.name == "Front Bumper Cover")
    reached = {
        e.dst_part_id for e in catalogue.edges if e.src_part_id == cover.part_id
    }
    names = {catalogue.by_id[pid].name.lower() for pid in reached}
    assert not any("door" in name for name in names)
    assert not any("cv joint" in name for name in names)


def test_assembly_tokens_ignore_position_words():
    assert edge_builder.assembly_tokens("Front Bumper Cover Retainer - Right Upper") == {
        "front", "bumper", "cover", "retainer",
    }


def test_edges_are_unique(catalogue):
    keys = {(e.src_part_id, e.dst_part_id, e.relation) for e in catalogue.edges}
    assert len(keys) == len(catalogue.edges)


def test_edges_reference_real_parts(catalogue):
    known = set(catalogue.by_id)
    assert all(
        e.src_part_id in known and e.dst_part_id in known for e in catalogue.edges
    )


# --- interpreter ------------------------------------------------------------

def test_interpreter_extracts_parts_and_descriptor():
    parsed = interpreter.parse(registry.prediction_for(SLUG))
    assert parsed.zone == "front"
    assert parsed.severity >= 3
    assert len(parsed.parts) > 5
    assert all(0.0 < p.p <= 1.0 for p in parsed.parts)


def test_interpreter_surfaces_the_left_right_conflict():
    """The shipped Yaris frames genuinely disagree, which is what drives the
    clarifying question in spec 6.5."""
    parsed = interpreter.parse(registry.prediction_for(SLUG))
    side_conflicts = [c for c in parsed.conflicts if c["field"] == "side"]
    assert side_conflicts
    assert set(side_conflicts[0]["values"]) == {"L", "R"}


def test_interpreter_part_ids_resolve_into_the_catalogue(catalogue):
    parsed = interpreter.parse(registry.prediction_for(SLUG))
    resolved = [p for p in parsed.parts if p.part_id in catalogue.by_id]
    assert len(resolved) >= len(parsed.parts) * 0.8


def test_missing_prediction_returns_none():
    assert registry.prediction_for("not-a-vehicle") is None


def test_in_progress_oem_matching_falls_back_to_class_claims():
    """The Jaguar ships oem_parts as `in_progress`, so there are no part ids.

    Its raw_parts stage is complete, so the assistant degrades to class-level
    claims rather than showing an empty report.
    """
    parsed = interpreter.parse(registry.prediction_for("jaguar-epace-rfh447"))
    assert parsed.in_progress is True
    assert parsed.parts == []
    assert parsed.klasses, "raw part names should still produce class claims"
    assert "bumper_cover" in parsed.klasses
    assert parsed.available is True


def test_completed_matching_does_not_use_the_fallback():
    parsed = interpreter.parse(registry.prediction_for(SLUG))
    assert parsed.in_progress is False
    assert parsed.parts and not parsed.klasses


@pytest.mark.parametrize("slug", registry.prediction_slugs())
def test_every_shipped_prediction_parses(slug):
    parsed = interpreter.parse(registry.prediction_for(slug))
    assert parsed.zone in {"front", "rear", "left", "right", "other"}
    assert 1 <= parsed.severity <= 5
    assert parsed.available, f"{slug} produced no usable evidence at all"
