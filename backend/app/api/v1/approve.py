"""Customer approval: the repairer sends a quote, the customer picks an option.

Not in spec 4-8, which stops at `POST /v1/parts/finalise`. It exists because the
web app is a customer-facing approval page and that flow has to survive the move
off the old backend.

The approval link is addressed by an unguessable token, not by case id. A
customer receives this link by text message and must not be able to walk it to
another job by editing the URL.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends

from app.api.deps import require_case
from app.api.errors import ApiError
from app.catalogue import registry
from app.config import settings
from app.schemas.requests import SubmitApprovalRequest
from app.services import approval_service
from app.store import cases
from app.store.cases import Case

router = APIRouter(tags=["approve"])


@router.post("/case/{case_id}/send-to-customer")
async def send_to_customer(case: Case = Depends(require_case)) -> dict:
    vehicle = cases.get_vehicle(case.vehicle_id)
    catalogue = registry.get(vehicle.slug) if vehicle and vehicle.slug else None
    if catalogue is None:
        # `catalogue_unavailable` defaults to HTTP 200 (spec 6.9), which is right
        # for a *report* degrading to class-level predictions. It is wrong for an
        # action: a 200 here would have the client read `approval_url` off an
        # error body and render a QR code pointing nowhere.
        raise ApiError(
            "catalogue_unavailable",
            "this vehicle has no OEM catalogue, so there is nothing to quote",
            status=409,
        )

    report = case.last_report
    if not report:
        raise ApiError("prediction_unavailable", "nothing to quote yet")

    lines = approval_service.build_lines(report, catalogue)
    if not lines:
        raise ApiError("prediction_unavailable", "no parts to quote")

    token = case.approval_token or secrets.token_urlsafe(16)
    case.approval_token = token
    case.approval_lines = lines
    case.status = "sent_to_customer"
    cases.touch(case)

    return {
        "case_id": case.id,
        "token": token,
        "approval_url": f"{settings.web_base_url}/approve/{token}",
        "lines": lines,
        "simulated": True,
    }


@router.get("/approve/{token}")
async def get_approval(token: str) -> dict:
    case = cases.case_by_approval_token(token)
    if case is None:
        raise ApiError("case_not_found", "this approval link is not valid")
    return approval_service.payload(case)


@router.post("/approve/{token}")
async def submit_approval(token: str, body: SubmitApprovalRequest) -> dict:
    case = cases.case_by_approval_token(token)
    if case is None:
        raise ApiError("case_not_found", "this approval link is not valid")

    if (body.option_id is None) == (body.lines is None):
        raise ApiError("invalid_request", "send exactly one of option_id or lines")

    if body.option_id is not None:
        if not approval_service.has_option(case, body.option_id):
            raise ApiError("invalid_request", f"unknown option {body.option_id}")
        approval_service.approve(case, body.option_id)
        return approval_service.payload(case)

    picks = [pick.model_dump() for pick in body.lines or []]
    accepted = approval_service.approve_lines(case, picks)
    if accepted == 0:
        raise ApiError("invalid_request", "no valid picks in the submission")
    return approval_service.payload(case)
