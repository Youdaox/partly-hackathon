"""Transcript -> structured evidence.

The interesting cases are all about not over-reading: a negation must clear its
own clause and no more, and a hedge must weaken rather than assert.
"""

from __future__ import annotations

import pytest

from app.services.speech_service import CERTAINTY_P, extract


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


@pytest.mark.parametrize(
    "text,klass,level",
    [
        ("the bumper's destroyed", "bumper_cover", "firm"),
        ("the bumper's had it", "bumper_cover", "firm"),
        ("the headlight's probably gone", "headlamp", "likely"),
        ("I think there might be suspension damage", "suspension_arm", "possible"),
        ("not sure about the rail", "side_member", "unsure"),
    ],
)
def test_hedging_ladder_maps_to_four_confidences(text, klass, level):
    """Spec 8.3's table, verbatim."""
    evidence = extract(text)
    assert evidence.klasses[klass] == CERTAINTY_P[level]
    assert evidence.certainty[klass] == level


def test_ladder_values_match_the_spec():
    assert CERTAINTY_P == {"firm": 0.95, "likely": 0.70, "possible": 0.45, "unsure": 0.35}


def test_unsure_mentions_become_question_candidates():
    evidence = extract("not sure about the rail")
    assert evidence.question_candidates == ["side_member"]
    # ...and "not sure" is a hedge, not a negation.
    assert "side_member" not in evidence.cleared


def test_hedging_is_scoped_per_clause():
    """One hedged mention must not weaken a firm one in the same sentence."""
    evidence = extract("the bumper's destroyed, might be some suspension damage too")
    assert evidence.klasses["bumper_cover"] == CERTAINTY_P["firm"]
    assert evidence.klasses["suspension_arm"] == CERTAINTY_P["possible"]


def test_weakest_rung_wins_when_hedges_stack_in_one_clause():
    evidence = extract("not sure if the rail might be bent")
    assert evidence.certainty["side_member"] == "unsure"


def test_certainty_does_not_leak_between_clauses():
    """A hedge in one clause must not weaken a firm claim in another.

    This is the same scoping that stops "bumper's off but the wheel looks
    straight" from clearing the bumper.
    """
    evidence = extract("the bumper's destroyed, not sure about the rail")
    assert evidence.certainty["bumper_cover"] == "firm"
    assert evidence.certainty["side_member"] == "unsure"


def test_teardown_language_is_not_a_damage_claim():
    """"The wheel has been removed" describes progress, not a broken hub."""
    evidence = extract("the wheel has been removed")
    assert "wheel_hub" not in evidence.klasses
    assert evidence.teardown_mentioned is True
    assert evidence.severity == 3


def test_spec_worked_example():
    """The brief's own sentence, from spec 8.3."""
    evidence = extract(
        "The front left corner has taken a big impact. The bumper is damaged "
        "and the wheel has been removed. I think there might be suspension damage."
    )
    assert evidence.zone == "front"
    assert evidence.side == "L"
    assert evidence.severity >= 3
    assert evidence.klasses["bumper_cover"] == CERTAINTY_P["firm"]
    assert evidence.klasses["suspension_arm"] == CERTAINTY_P["possible"]


def test_unparseable_text_asserts_nothing():
    evidence = extract("yeah nah mate")
    assert not evidence.klasses
    assert evidence.zone is None
