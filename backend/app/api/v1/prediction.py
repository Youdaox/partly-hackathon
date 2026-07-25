"""Prediction run, results and the confirm loop (spec 6.6)."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.api.deps import require_case
from app.api.errors import ApiError
from app.schemas.requests import ConfirmRequest, PredictionRunRequest
from app.services import case_service, media_service
from app.store import cases
from app.store.cases import Case

router = APIRouter(tags=["prediction"])


@router.post("/prediction/run")
async def run(body: PredictionRunRequest) -> dict:
    case = require_case(body.case_id)
    started = time.perf_counter()
    payload = case_service.repredict(case.id)
    if payload is None:
        raise ApiError("prediction_unavailable", "no Interpreter output for this vehicle")
    return {
        "prediction_id": cases.new_id("pred"),
        "computed_ms": int((time.perf_counter() - started) * 1000),
    }


@router.get("/prediction/results/{case_id}")
async def results(case: Case = Depends(require_case)) -> dict:
    if case.last_report is None:
        payload = case_service.repredict(case.id)
        if payload is None:
            raise ApiError("prediction_unavailable", "no Interpreter output for this vehicle")
        return payload

    # The report is a cached snapshot of a propagation, but uploads do not
    # cause one — they are recorded, not analysed. Refreshing the list here
    # costs a store read and keeps it from lagging behind what was uploaded.
    case.last_report["media"] = [
        media_service.payload(asset) for asset in cases.uploaded_media(case)
    ]
    return case.last_report


@router.post("/inspection/confirm")
async def confirm(body: ConfirmRequest) -> dict:
    require_case(body.case_id)
    payload = case_service.confirm(body.case_id, body.part_id, body.damaged)
    if payload is None:
        raise ApiError("prediction_unavailable", "case has no prediction to update")
    return payload
