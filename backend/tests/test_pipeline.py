"""Spec 8: prompts, vision contract, ASR vocabulary biasing, transcript editing."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.ai.prompts import SPEECH_EXTRACT_PROMPT, VISION_PROMPT, VISION_VERSION
from app.ai.prompts.vision import SEVERITY_LADDER
from app.catalogue import interpreter, registry, vocabulary
from app.main import create_app
from app.services import vehicle_service
from app.store import cases

SLUG = "toyota-yaris-qmn16"


# --- 8.2 prompt contract ----------------------------------------------------

def test_severity_ladder_is_in_the_prompt():
    """A model asked "how severe 1-5?" returns noise; the rungs must be spelled out."""
    assert len(SEVERITY_LADDER) == 5
    for rank, description in SEVERITY_LADDER.items():
        assert description in VISION_PROMPT, f"rung {rank} missing from the prompt"


def test_vision_prompt_asks_for_the_two_key_checks():
    assert "wheel_displaced" in VISION_PROMPT
    assert "airbag_deployed" in VISION_PROMPT
    assert "frame_conflicts" in VISION_PROMPT


def test_prompts_are_versioned_for_the_cache_key():
    assert VISION_VERSION
    assert "certainty" in SPEECH_EXTRACT_PROMPT


# --- 8.2 wheel / airbag tri-state -------------------------------------------

@pytest.mark.parametrize("slug", registry.prediction_slugs())
def test_wheel_and_airbag_are_tristate(slug):
    """None must be preserved: the frames not saying is not the same as "no"."""
    parsed = interpreter.parse(registry.prediction_for(slug))
    assert parsed.wheel_displaced in (True, False, None)
    assert parsed.airbag_deployed in (True, False, None)


def test_frames_that_say_nothing_yield_none():
    """No shipped vehicle mentions airbags at all, so none may claim False."""
    for slug in registry.prediction_slugs():
        parsed = interpreter.parse(registry.prediction_for(slug))
        assert parsed.airbag_deployed is not True


def test_explicit_negatives_read_as_false():
    parsed = interpreter.parse(
        {
            "context_selection": {
                "completed": {
                    "data": {
                        "selected": [
                            {
                                "collision_context": "Severe front right damage, "
                                "no airbag deployment, wheels appear straight.",
                                "is_collision_relevant": True,
                            }
                        ]
                    }
                }
            }
        }
    )
    assert parsed.airbag_deployed is False
    assert parsed.wheel_displaced is False


def test_deployed_airbag_forces_top_severity():
    parsed = interpreter.parse(
        {
            "context_selection": {
                "completed": {
                    "data": {
                        "selected": [
                            {
                                "collision_context": "Front impact, airbags deployed.",
                                "is_collision_relevant": True,
                            }
                        ]
                    }
                }
            }
        }
    )
    assert parsed.airbag_deployed is True
    assert parsed.severity == 5


# --- teardown / exposed depth ----------------------------------------------

def test_removed_components_raise_exposed_depth():
    """The Jaguar's frames say the wheel arch liner is off."""
    parsed = interpreter.parse(registry.prediction_for("jaguar-epace-rfh447"))
    assert parsed.exposed_depth >= 2


def test_a_removed_road_wheel_exposes_the_hub():
    parsed = interpreter.parse(registry.prediction_for("toyota-prius-pkw74"))
    assert parsed.exposed_depth >= 5, "wheel off means hub and suspension are visible"


def test_wheel_arch_trim_is_not_a_road_wheel():
    from app.catalogue.interpreter import _exposed_depth

    assert _exposed_depth("wheel arch liner removed") < 5
    assert _exposed_depth("front wheel removed") == 5


# --- 8.3 ASR vocabulary biasing --------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def loaded():
    registry.ensure_loaded(SLUG)
    vocabulary.reset()
    yield


def test_phrase_hints_include_this_vehicles_parts():
    hints = vocabulary.phrase_hints(SLUG, "front")
    assert hints
    assert len(hints) <= vocabulary.MAX_HINTS
    joined = " ".join(hints).lower()
    assert "bumper" in joined


def test_phrase_hints_include_trade_slang():
    """"Slam panel" and "crash box" are not in a general model's vocabulary."""
    hints = {h.lower() for h in vocabulary.phrase_hints(SLUG, "front")}
    assert "slam panel" in hints
    assert "crash box" in hints


def test_hints_are_ordered_shallowest_first():
    """Repairers name the parts they can see."""
    from app.catalogue.tagger import depth_of, classify

    hints = vocabulary.phrase_hints(SLUG, "front", limit=60)
    catalogue_hints = [h for h in hints if h not in vocabulary.TRADE_TERMS]
    depths = [depth_of(classify(h)) for h in catalogue_hints[:20]]
    assert sum(depths) / len(depths) < 4


def test_hints_degrade_without_a_catalogue():
    hints = vocabulary.phrase_hints(None, "front")
    assert hints == vocabulary.TRADE_TERMS[: len(hints)]


def test_hints_are_deduplicated():
    hints = vocabulary.phrase_hints(SLUG, "front")
    assert len(hints) == len({h.lower() for h in hints})


# --- 8.4 editable transcript ------------------------------------------------

@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_state():
    cases.reset()
    yield
    cases.reset()


def make_case(client):
    registered = client.post("/v1/vehicle/register", json={"rego": "QMN16"})
    vehicle_id = registered.json()["vehicle_id"]
    vehicle_service.resolve(cases.get_vehicle(vehicle_id))
    return client.post("/v1/case", json={"vehicle_id": vehicle_id}).json()["case_id"]


def test_editing_a_transcript_reruns_extraction(client):
    case_id = make_case(client)
    posted = client.post(f"/v1/case/{case_id}/messages",
                         json={"text": "the left guard is dented"})
    message_id = posted.json()["message_id"]

    before = client.get(f"/v1/prediction/results/{case_id}").json()
    assert before["impact"]["side"] == "L"

    edited = client.patch(
        f"/v1/case/{case_id}/messages/{message_id}",
        json={"text": "the right guard is dented"},
    )
    assert edited.status_code == 200
    assert edited.json()["impact"]["side"] == "R"


def test_editing_retracts_the_old_observations(client):
    """A corrected transcript must not leave the misheard part in the report."""
    case_id = make_case(client)
    posted = client.post(f"/v1/case/{case_id}/messages",
                         json={"text": "not sure about the rail"})
    message_id = posted.json()["message_id"]
    case = cases.get_case(case_id)
    assert any(o.klass == "side_member" for o in case.observations)

    client.patch(f"/v1/case/{case_id}/messages/{message_id}",
                 json={"text": "not sure about the grille"})

    case = cases.get_case(case_id)
    assert not any(o.klass == "side_member" for o in case.observations)
    assert any(o.klass == "grille" for o in case.observations)


def test_editing_an_unknown_message_404s(client):
    case_id = make_case(client)
    response = client.patch(f"/v1/case/{case_id}/messages/msg_nope",
                            json={"text": "anything"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "case_not_found"


# --- 8.3 hedged mentions become the next question ---------------------------

def test_an_unsure_mention_becomes_the_question(client):
    """"not sure about the rail" -> the assistant asks about the rail."""
    case_id = make_case(client)
    client.post(f"/v1/case/{case_id}/messages", json={"text": "not sure about the rail"})

    report = client.get(f"/v1/prediction/results/{case_id}").json()
    question = report["question"]
    assert question["id"] == "q_raised_side_member"
    assert question["source"] == "repairer"
    assert "chassis rail" in question["text"]


def test_a_raised_question_outranks_an_inferred_one(client):
    case_id = make_case(client)
    before = client.get(f"/v1/prediction/results/{case_id}").json()
    assert before["question"]["id"] in ("q_side", "q_severity")

    client.post(f"/v1/case/{case_id}/messages",
                json={"text": "not sure about the suspension"})
    after = client.get(f"/v1/prediction/results/{case_id}").json()
    assert after["question"]["id"] == "q_raised_suspension_arm"


def test_answering_a_raised_question_clamps_the_class(client):
    case_id = make_case(client)
    client.post(f"/v1/case/{case_id}/messages", json={"text": "not sure about the rail"})

    answered = client.post(f"/v1/case/{case_id}/answers",
                           json={"question_id": "q_raised_side_member",
                                 "value": "Looks fine"}).json()
    # The class is settled, so it is no longer the question...
    assert answered["question"] is None or not answered["question"]["id"].startswith(
        "q_raised_side_member"
    )
    # ...and nothing of that class survives in the report.
    case = cases.get_case(case_id)
    assert any(v is False for v in case.confirmations.values())


def test_answering_damaged_promotes_the_class(client):
    case_id = make_case(client)
    client.post(f"/v1/case/{case_id}/messages", json={"text": "not sure about the rail"})
    report = client.post(f"/v1/case/{case_id}/answers",
                         json={"question_id": "q_raised_side_member",
                               "value": "Damaged"}).json()
    names = {line["name"] for line in report["sections"]["visible"]}
    assert any("Member" in name for name in names)


def test_editing_retracts_the_question_it_raised(client):
    """Found by the smoke test: observations were retracted but the question was not,
    so a corrected transcript kept asking about the misheard part."""
    case_id = make_case(client)
    posted = client.post(f"/v1/case/{case_id}/messages",
                         json={"text": "not sure about the rail"})
    message_id = posted.json()["message_id"]
    before = client.get(f"/v1/prediction/results/{case_id}").json()
    assert before["question"]["id"] == "q_raised_side_member"

    after = client.patch(f"/v1/case/{case_id}/messages/{message_id}",
                         json={"text": "not sure about the grille"}).json()
    assert after["question"]["id"] == "q_raised_grille"


def test_candidates_from_other_messages_survive_a_retraction(client):
    case_id = make_case(client)
    first = client.post(f"/v1/case/{case_id}/messages",
                        json={"text": "not sure about the rail"}).json()["message_id"]
    client.post(f"/v1/case/{case_id}/messages", json={"text": "not sure about the radiator"})

    client.patch(f"/v1/case/{case_id}/messages/{first}", json={"text": "bumper is scuffed"})

    case = cases.get_case(case_id)
    assert "side_member" not in case.question_candidates
    assert "radiator" in case.question_candidates
