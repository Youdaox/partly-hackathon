"""Customer approval and the case list.

Neither is in spec 4-8. They exist because the web app is a customer-facing
approval page and a front-desk dashboard, and both had to survive the move off
the old TypeScript backend.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import vehicle_service
from app.store import cases


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_state():
    cases.reset()
    yield
    cases.reset()


def make_case(client, rego="QMN16"):
    registered = client.post("/v1/vehicle/register", json={"rego": rego})
    vehicle_id = registered.json()["vehicle_id"]
    vehicle_service.resolve(cases.get_vehicle(vehicle_id))
    return client.post("/v1/case", json={"vehicle_id": vehicle_id}).json()["case_id"]


# --- case list --------------------------------------------------------------

def test_cases_list_is_empty_before_anything_happens(client):
    assert client.get("/v1/cases").json()["cases"] == []


def test_cases_list_carries_what_the_drawer_renders(client):
    case_id = make_case(client)
    row = client.get("/v1/cases").json()["cases"][0]
    assert row["case_id"] == case_id
    assert row["vehicle"]["rego"] == "QMN16"
    assert row["vehicle"]["make"] == "Toyota"
    assert row["impact"]["zone"] == "front"
    assert row["approval_token"] is None


def test_cases_list_is_most_recent_first(client):
    first = make_case(client)
    second = make_case(client, "PNS53")
    ids = [row["case_id"] for row in client.get("/v1/cases").json()["cases"]]
    assert ids.index(second) < ids.index(first)


# --- send to customer -------------------------------------------------------

def test_send_to_customer_returns_a_link(client):
    case_id = make_case(client)
    body = client.post(f"/v1/case/{case_id}/send-to-customer").json()

    assert body["token"]
    assert body["approval_url"].endswith(body["token"])
    assert body["simulated"] is True
    assert body["lines"]


def test_the_link_is_not_the_case_id(client):
    """A customer must not be able to walk the URL to someone else's job."""
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    assert token != case_id
    assert case_id not in token
    assert client.get(f"/v1/approve/{case_id}").status_code == 404


def test_resending_keeps_the_same_link(client):
    """A repairer who taps twice must not invalidate the text they already sent."""
    case_id = make_case(client)
    first = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    second = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    assert first == second


def test_sending_moves_the_case_status(client):
    case_id = make_case(client)
    client.post(f"/v1/case/{case_id}/send-to-customer")
    row = next(r for r in client.get("/v1/cases").json()["cases"] if r["case_id"] == case_id)
    assert row["status"] == "sent_to_customer"
    assert row["approval_token"]


# --- the approval page ------------------------------------------------------

def test_approval_payload_has_what_the_page_renders(client):
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]

    body = client.get(f"/v1/approve/{token}").json()
    assert body["vehicle"]["rego"] == "QMN16"
    assert body["approved_option"] is None
    assert body["simulated"] is True
    assert body["totals"]["cheapest_nzd"] > 0
    assert body["totals"]["recommended_nzd"] >= body["totals"]["cheapest_nzd"]

    for line in body["lines"]:
        assert line["options"], "every line needs something to choose between"
        assert line["kind"] in ("visible", "hidden")


def test_predicted_parts_are_labelled_as_such(client):
    """The customer should see which parts are inferred rather than seen."""
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    kinds = {line["kind"] for line in client.get(f"/v1/approve/{token}").json()["lines"]}
    assert "visible" in kinds


def test_unknown_token_404s(client):
    response = client.get("/v1/approve/not-a-real-token")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "case_not_found"


# --- approving --------------------------------------------------------------

def test_approving_records_the_choice(client):
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    payload = client.get(f"/v1/approve/{token}").json()
    option_id = payload["lines"][0]["options"][0]["id"]

    approved = client.post(f"/v1/approve/{token}", json={"option_id": option_id}).json()
    assert approved["approved_option"] == option_id
    assert approved["approved_at"] is not None
    assert approved["status"] == "approved"


def test_approval_survives_a_reload(client):
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    option_id = client.get(f"/v1/approve/{token}").json()["lines"][0]["options"][0]["id"]
    client.post(f"/v1/approve/{token}", json={"option_id": option_id})

    assert client.get(f"/v1/approve/{token}").json()["approved_option"] == option_id


def test_an_invented_option_is_rejected(client):
    case_id = make_case(client)
    token = client.post(f"/v1/case/{case_id}/send-to-customer").json()["token"]
    response = client.post(f"/v1/approve/{token}", json={"option_id": "off_made_up"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_no_catalogue_vehicle_cannot_be_quoted(client):
    """Must be a real failure status, not the 200 that `catalogue_unavailable`
    defaults to — otherwise the client renders a QR code pointing nowhere."""
    case_id = make_case(client, "NUE975")
    response = client.post(f"/v1/case/{case_id}/send-to-customer")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "catalogue_unavailable"
