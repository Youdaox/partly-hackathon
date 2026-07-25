"""Transcript -> structured evidence.

The interesting cases are all about not over-reading: a negation must clear its
own clause and no more, and a hedge must weaken rather than assert.
"""

from __future__ import annotations

import pytest

from app.services.speech_service import HEDGED_P, SPOKEN_P, extract


def test_reads_zone_side_and_severity():
    evidence = extract("front right's taken a hit, bumper's off")
    assert evidence.zone == "front"
    assert evidence.side == "R"
    assert "bumper_cover" in evidence.klasses


def test_both_sides_mentioned_reads_as_both():
    assert extract("damage on the left and right corners").side == "both"


def test_workshop_slang_maps_to_klasses():
    evidence = extract("the reo is bent and the guard is creased")
    assert "reinforcement_beam" in evidence.klasses
    assert "fender" in evidence.klasses


def test_reinforcement_damage_is_structural_severity():
    """"Bent" alone is a 2; a bent reo is a 4."""
    assert extract("the door is bent").severity == 2
    assert extract("the reo behind the bumper is bent").severity == 4


@pytest.mark.parametrize(
    "text,expected",
    [
        ("just a scuff on the bumper", 1),
        ("the bumper is cracked", 2),
        ("headlight is smashed", 3),
        ("the chassis rail is pushed back", 4),
        ("it's a write-off", 5),
    ],
)
def test_severity_ladder(text, expected):
    assert extract(text).severity == expected


def test_negation_clears_only_its_own_clause():
    """The failure to avoid: clearing the bumper because the wheel is fine."""
    evidence = extract("bumper's off but the wheel looks straight")
    assert "bumper_cover" in evidence.klasses
    assert "wheel_hub" in evidence.cleared
    assert "bumper_cover" not in evidence.cleared


def test_negation_is_recorded_not_just_ignored():
    evidence = extract("no airbags went off")
    assert "airbag_module" in evidence.cleared
    assert "airbag_module" not in evidence.klasses


def test_hedged_claims_are_weaker():
    confident = extract("the headlight is smashed")
    hedged = extract("the headlight might be cracked")
    assert confident.klasses["headlamp"] == SPOKEN_P
    assert hedged.klasses["headlamp"] == HEDGED_P


def test_unparseable_text_asserts_nothing():
    evidence = extract("yeah nah mate")
    assert not evidence.klasses
    assert evidence.zone is None
