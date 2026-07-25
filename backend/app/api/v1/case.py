"""Case lifecycle, SSE stream, messages and answers (spec 6.3)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import require_case, require_vehicle
from app.api.errors import ApiError
from app.schemas.requests import (
    AnswerRequest,
    CreateCaseRequest,
    MessageRequest,
    TranscriptEditRequest,
)
from app.services import case_service
from app.store import cases
from app.store.cases import Case
from app.utils import sse

router = APIRouter(tags=["case"])

# Keeps proxies from closing an idle stream.
HEARTBEAT_SECONDS = 15.0


@router.post("/case", status_code=201)
async def create_case(body: CreateCaseRequest) -> dict:
    vehicle = cases.get_vehicle(body.vehicle_id)
    if vehicle is None:
        raise ApiError("vehicle_not_found", f"no vehicle {body.vehicle_id}")
    if vehicle.status == "resolving":
        raise ApiError("vehicle_not_ready", "the catalogue is still loading")

    case = case_service.create(vehicle.id)
    # Populate from the shipped Interpreter output so the first view is not empty.
    case_service.seed_from_interpreter(case)
    case_service.repredict(case.id)
    return {"case_id": case.id, "status": case.status}


@router.get("/cases")
async def list_cases() -> dict:
    """Every open case, most recent first.

    Exists for the recent-jobs drawer. Deliberately a summary, not a list of full
    reports — the drawer renders one line per case and a report is ~8 KB each.
    """
    return {
        "cases": [
            {
                "case_id": case.id,
                "status": case.status,
                "impact": {
                    "zone": case.zone,
                    "side": case.side,
                    "severity": case.severity,
                },
                "vehicle": _vehicle_stub(case),
                # The front desk links straight to the customer's quote. This is
                # an internal endpoint; the token is only secret to the customer.
                "approval_token": case.approval_token,
                "updated_at": case.updated_at,
                "created_at": case.created_at,
            }
            for case in cases.recent_cases()
        ]
    }


def _vehicle_stub(case: Case) -> dict:
    vehicle = cases.get_vehicle(case.vehicle_id)
    if vehicle is None:
        return {"rego": None, "make": None, "model": None, "year": None}
    return {
        "rego": vehicle.rego,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
    }


@router.get("/case/{case_id}")
async def get_case(case: Case = Depends(require_case)) -> dict:
    return {
        "case_id": case.id,
        "vehicle_id": case.vehicle_id,
        "status": case.status,
        "impact": {"zone": case.zone, "side": case.side, "severity": case.severity},
        "messages": [
            {
                "id": message.id,
                "role": message.role,
                "kind": message.kind,
                "text": message.text,
                "transcript": message.transcript,
                "created_at": message.created_at,
            }
            for message in case.messages
        ],
        "report": case.last_report,
    }


@router.get("/case/{case_id}/stream")
async def stream(case: Case = Depends(require_case)) -> StreamingResponse:
    queue = sse.subscribe(case.id)

    async def events():
        try:
            # Anything already computed goes out immediately, so a late
            # subscriber is never behind.
            if case.last_report is not None:
                yield sse.format_event("report", case.last_report)
            while True:
                try:
                    event, data = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
                    yield sse.format_event(event, data)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            sse.unsubscribe(case.id, queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/case/{case_id}/messages", status_code=202)
async def post_message(body: MessageRequest, case: Case = Depends(require_case)) -> dict:
    message = cases.add_message(case, role="repairer", kind="text", text=body.text)
    # Same downstream path as a transcript (spec 6.3).
    case_service.ingest_text(case, body.text, source="speech", source_ref=message.id)
    case_service.repredict(case.id)
    return {"message_id": message.id}


@router.patch("/case/{case_id}/messages/{message_id}")
async def edit_transcript(
    message_id: str,
    body: TranscriptEditRequest,
    case: Case = Depends(require_case),
) -> dict:
    """Correct a wrong transcript (spec 8.4).

    Observations from the original text are retired rather than added to —
    otherwise a misheard "rail" would linger as evidence after being corrected
    to "grille". Everything else about the case is untouched.
    """
    message = next((m for m in case.messages if m.id == message_id), None)
    if message is None:
        raise ApiError("case_not_found", f"no message {message_id} on this case")

    case_service.retract_observations(case, source_ref=message.id)
    message.transcript = body.text
    message.text = body.text
    message.meta["edited"] = True

    case_service.ingest_text(case, body.text, source="repairer", source_ref=message.id)
    return case_service.repredict(case.id) or {}


@router.post("/case/{case_id}/answers")
async def post_answer(body: AnswerRequest, case: Case = Depends(require_case)) -> dict:
    value = body.value.strip().lower()
    case.questions_asked.add(body.question_id)

    if body.question_id == "q_side":
        case.side = {"right": "R", "left": "L", "both": "both"}.get(value, case.side)
        # An answered side conflict is a resolved one.
        case.conflicts = [c for c in case.conflicts if c.get("field") != "side"]

    elif body.question_id.startswith("q_raised_"):
        # Answering a klass the repairer raised themselves: clamp every part of
        # that class in the impact zone, and stop asking.
        klass = body.question_id.removeprefix("q_raised_")
        if value.startswith(("damaged", "yes")):
            case_service.confirm_klass(case, klass, damaged=True)
        elif value.startswith(("looks fine", "fine", "no")):
            case_service.confirm_klass(case, klass, damaged=False)
        case.question_candidates.pop(klass, None)

    # Severity discriminators (spec 9.5): each pins one boundary of the ladder.
    elif body.question_id == "q_wheels":
        # Straight wheels cap severity at 3; a shifted wheel is the S4 definition.
        if value.startswith("yes"):
            case.severity = min(case.severity, 3)
        elif value.startswith("no"):
            case.severity = max(case.severity, 4)
        case.severity_source = "repairer"

    elif body.question_id == "q_airbags":
        if value.startswith("yes"):
            case.severity = max(case.severity, 4)
        elif value.startswith("no"):
            case.severity = min(case.severity, 3)
        case.severity_source = "repairer"

    elif body.question_id == "q_door":
        if value.startswith("no"):
            case.severity = max(case.severity, 5)
        elif value.startswith("yes"):
            case.severity = min(case.severity, 4)
        case.severity_source = "repairer"

    cases.add_message(case, role="repairer", kind="question",
                      text=body.value, meta={"question_id": body.question_id})
    return case_service.repredict(case.id) or {}
