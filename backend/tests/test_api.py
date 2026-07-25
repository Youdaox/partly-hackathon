"""Endpoint contracts from spec 6.

Uses the real dataset and the real catalogue preload, so these are closer to
integration tests than unit tests — which is the point: the contract that
matters is the one the phone sees.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.catalogue import registry
from app.main import create_app
from app.services import vehicle_service
from app.store import cases

YARIS_REGO = "QMN16"
NO_CATALOGUE_REGO = "NUE975"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_state():
    cases.reset()
    yield
    cases.reset()


def make_case(client, rego=YARIS_REGO):
    """Register a vehicle, resolve it synchronously, open a case."""
    registered = client.post("/v1/vehicle/register", json={"rego": rego})
    vehicle_id = registered.json()["vehicle_id"]
    # Resolve without waiting on the simulated VIN latency.
    vehicle_service.resolve(cases.get_vehicle(vehicle_id))
    created = client.post("/v1/case", json={"vehicle_id": vehicle_id})
    return vehicle_id, created


# --- health and index -------------------------------------------------------

def test_healthz_reports_the_preload(client):
    body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["vehicles_loaded"] >= 1
    assert body["parts_indexed"] > 7000


def test_vehicles_index_flags_prediction_and_catalogue(client):
    body = client.get("/v1/vehicles").json()
    slugs = {v["slug"]: v for v in body["vehicles"]}
    assert "toyota-yaris-qmn16" in slugs
    yaris = slugs["toyota-yaris-qmn16"]
    assert yaris["has_prediction"] is True and yaris["has_catalogue"] is True
    # Five of the eight have an Interpreter result but no OEM catalogue.
    assert any(v["has_prediction"] and not v["has_catalogue"] for v in body["vehicles"])


# --- vehicle ----------------------------------------------------------------

def test_register_returns_202_and_a_status(client):
    response = client.post("/v1/vehicle/register", json={"rego": YARIS_REGO})
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "resolving"
    assert body["estimated_ms"] > 0


def test_unknown_rego_uses_the_error_envelope(client):
    response = client.post("/v1/vehicle/register", json={"rego": "ZZZ999"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "rego_not_found"
    assert response.json()["error"]["retryable"] is False


def test_resolved_vehicle_exposes_its_configuration(client):
    vehicle_id, _ = make_case(client)
    body = client.get(f"/v1/vehicle/{vehicle_id}").json()
    assert body["status"] == "catalogue_ready"
    assert body["vin"] == "JTDKBAA3301006094"
    assert body["parts_indexed"] == 7009
    assert body["model_code"] == "MXPH10R-AHXNBQ"
    assert body["market"] == "AUSTRALIA"


def test_no_catalogue_is_a_success_not_an_error(client):
    """Spec 6.2: four vehicles are make-plate only."""
    registered = client.post("/v1/vehicle/register", json={"rego": NO_CATALOGUE_REGO})
    vehicle_id = registered.json()["vehicle_id"]
    vehicle_service.resolve(cases.get_vehicle(vehicle_id))
    body = client.get(f"/v1/vehicle/{vehicle_id}").json()
    assert body["status"] == "no_catalogue"
    assert body["make"] == "Holden"


def test_missing_vehicle_404s(client):
    response = client.get("/v1/vehicle/veh_nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "vehicle_not_found"


# --- case -------------------------------------------------------------------

def test_case_creation_seeds_from_the_interpreter(client):
    _, created = make_case(client)
    assert created.status_code == 201
    case_id = created.json()["case_id"]

    report = client.get(f"/v1/prediction/results/{case_id}").json()
    assert report["status"] == "ready"
    assert report["impact"]["zone"] == "front"
    assert report["sections"]["visible"], "the first view must not be empty"


def test_case_on_unresolved_vehicle_409s(client):
    registered = client.post("/v1/vehicle/register", json={"rego": YARIS_REGO})
    response = client.post("/v1/case", json={"vehicle_id": registered.json()["vehicle_id"]})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "vehicle_not_ready"


def test_missing_case_404s(client):
    response = client.get("/v1/prediction/results/case_nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "case_not_found"


# --- report shape -----------------------------------------------------------

def test_report_matches_the_spec_6_6_shape(client):
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()

    assert set(report["sections"]) == {"visible", "order", "check"}
    assert report["vehicle"]["rego"] == YARIS_REGO

    for line in report["sections"]["visible"]:
        assert {"part_id", "part_number", "name", "p"} <= set(line)
        assert 0.0 <= line["p"] <= 1.0

    for line in report["sections"]["check"]:
        assert "reason" in line and "attribution" in line
        assert line["confirmed"] is None
        for cause in line["attribution"]:
            assert {"cause", "relation", "share"} == set(cause)


def test_section_caps_are_enforced(client):
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()
    assert len(report["sections"]["visible"]) <= 12
    assert len(report["sections"]["order"]) <= 8
    assert len(report["sections"]["check"]) <= 5


def test_payload_stays_under_20kb(client):
    """Spec 6.8."""
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()
    assert len(json.dumps(report).encode()) < 20 * 1024


def test_duplicate_part_names_are_collapsed(client):
    """The catalogue lists a part once per fitted position; a report must not."""
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()
    for section in report["sections"].values():
        names = [(line["name"], line["part_number"]) for line in section]
        assert len(names) == len(set(names))


# --- confirm loop -----------------------------------------------------------

def test_confirm_returns_a_full_replacement_report(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    report = client.get(f"/v1/prediction/results/{case_id}").json()
    if not report["sections"]["check"]:
        pytest.skip("no check items to confirm")
    target = report["sections"]["check"][0]["part_id"]

    confirmed = client.post(
        "/v1/inspection/confirm",
        json={"case_id": case_id, "part_id": target, "damaged": True},
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert set(body["sections"]) == {"visible", "order", "check"}
    assert target in {line["part_id"] for line in body["sections"]["visible"]}


def test_rejecting_a_part_removes_it(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    report = client.get(f"/v1/prediction/results/{case_id}").json()
    if not report["sections"]["check"]:
        pytest.skip("no check items to reject")
    target = report["sections"]["check"][0]["part_id"]

    body = client.post(
        "/v1/inspection/confirm",
        json={"case_id": case_id, "part_id": target, "damaged": False},
    ).json()
    everything = [
        line["part_id"] for section in body["sections"].values() for line in section
    ]
    assert target not in everything


def test_confirmations_accumulate(client):
    """Spec 7.4: the full clamp set, never just the newest."""
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    report = client.get(f"/v1/prediction/results/{case_id}").json()
    if len(report["sections"]["check"]) < 2:
        pytest.skip("need two check items")
    first, second = (line["part_id"] for line in report["sections"]["check"][:2])

    client.post("/v1/inspection/confirm",
                json={"case_id": case_id, "part_id": first, "damaged": True})
    body = client.post("/v1/inspection/confirm",
                       json={"case_id": case_id, "part_id": second, "damaged": True}).json()

    visible = {line["part_id"] for line in body["sections"]["visible"]}
    assert first in visible and second in visible


# --- messages and answers ---------------------------------------------------

def test_text_message_updates_the_impact_descriptor(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]

    response = client.post(f"/v1/case/{case_id}/messages",
                           json={"text": "it's the left front guard, just scuffed"})
    assert response.status_code == 202

    report = client.get(f"/v1/prediction/results/{case_id}").json()
    assert report["impact"]["side"] == "L"
    assert report["impact"]["severity"] == 1


def test_answering_the_side_question_resolves_the_conflict(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]

    body = client.post(f"/v1/case/{case_id}/answers",
                       json={"question_id": "q_side", "value": "Right"}).json()
    assert body["impact"]["side"] == "R"

    damage = client.get(f"/v1/damage/report/{case_id}").json()
    assert not [c for c in damage["conflicts"] if c["field"] == "side"]


# --- damage report ----------------------------------------------------------

def test_damage_report_exposes_impact_and_conflicts(client):
    _, created = make_case(client)
    body = client.get(f"/v1/damage/report/{created.json()['case_id']}").json()
    assert {"case_id", "impact", "visible", "conflicts"} <= set(body)
    assert body["impact"]["evidence"], "the frame commentary should be carried through"
    assert all("sources" in line for line in body["visible"])


# --- parts and ordering -----------------------------------------------------

def test_recommendations_are_labelled_simulated(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    body = client.get("/v1/parts/recommendations", params={"case_id": case_id}).json()
    assert body["simulated"] is True
    assert body["lines"]
    for line in body["lines"]:
        assert line["offers"]
        assert sum(1 for offer in line["offers"] if offer["recommended"]) == 1


def test_finalise_persists_rejections(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    report = client.get(f"/v1/prediction/results/{case_id}").json()
    lines = [
        {"part_id": line["part_id"], "qty": 1, "action": "accept"}
        for line in report["sections"]["visible"][:2]
    ]
    if report["sections"]["check"]:
        lines.append({"part_id": report["sections"]["check"][0]["part_id"],
                      "action": "reject"})

    body = client.post("/v1/parts/finalise",
                       json={"case_id": case_id, "lines": lines}).json()
    assert body["state"] == "placed"
    assert body["simulated"] is True
    assert body["total_nzd"] > 0
    assert any(line["action"] == "reject" for line in body["lines"])


# --- media ------------------------------------------------------------------

def test_unsupported_media_is_rejected(client):
    _, created = make_case(client)
    case_id = created.json()["case_id"]
    response = client.post(
        "/v1/media/upload",
        data={"case_id": case_id, "kind": "image"},
        files={"files": ("evil.exe", b"MZ", "application/x-msdownload")},
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media"


def test_upload_to_a_missing_case_404s(client):
    response = client.post(
        "/v1/media/upload",
        data={"case_id": "case_nope", "kind": "image"},
        files={"files": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert response.status_code == 404


# --- diagrams ---------------------------------------------------------------

def test_report_flags_which_diagrams_have_images(client):
    """Only 50 of the Yaris's 187 diagrams ship assets, so the report says which."""
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()
    lines = [
        line
        for section in report["sections"].values()
        for line in section
        if line.get("diagram_id")
    ]
    assert lines, "expected at least one line with a diagram"
    assert all(isinstance(line["diagram_available"], bool) for line in lines)


def test_diagram_image_is_served_immutable(client):
    _, created = make_case(client)
    report = client.get(f"/v1/prediction/results/{created.json()['case_id']}").json()
    diagram_id = next(
        (
            line["diagram_id"]
            for section in report["sections"].values()
            for line in section
            if line.get("diagram_available")
        ),
        None,
    )
    if diagram_id is None:
        pytest.skip("no report line references a diagram with a shipped image")

    response = client.get(f"/v1/vehicles/toyota-yaris-qmn16/diagrams/{diagram_id}/image")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert "immutable" in response.headers["cache-control"]

    annotations = client.get(
        f"/v1/vehicles/toyota-yaris-qmn16/diagrams/{diagram_id}/annotations"
    )
    assert annotations.status_code == 200


def test_missing_diagram_404s(client):
    response = client.get("/v1/vehicles/toyota-yaris-qmn16/diagrams/nope/image")
    assert response.status_code == 404
