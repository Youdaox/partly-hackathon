"""Case lifecycle, SSE stream, messages and answers (spec 6.3)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import require_case, require_vehicle
from app.api.errors import ApiError
from app.schemas.requests import AnswerRequest, CreateCaseRequest, MessageRequest
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


@router.post("/case/{case_id}/answers")
async def post_answer(body: AnswerRequest, case: Case = Depends(require_case)) -> dict:
    value = body.value.strip().lower()

    if body.question_id == "q_side":
        case.side = {"right": "R", "left": "L", "both": "both"}.get(value, case.side)
        # An answered side conflict is a resolved one.
        case.conflicts = [c for c in case.conflicts if c.get("field") != "side"]
    elif body.question_id == "q_severity":
        if value.startswith("just"):
            case.severity = min(case.severity, 2)
        elif value.startswith("structure"):
            case.severity = max(case.severity, 4)
        case.severity_source = "repairer"

    cases.add_message(case, role="repairer", kind="question",
                      text=body.value, meta={"question_id": body.question_id})
    return case_service.repredict(case.id) or {}
