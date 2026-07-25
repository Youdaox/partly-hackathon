"""Forced re-analysis and the visible-damage layer (spec 6.5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_asr, get_vision, require_case
from app.catalogue import registry
from app.engines import orchestrator
from app.engines.history import EMPTY_HISTORY
from app.schemas.requests import AnalyseRequest
from app.services import case_service, evidence_service, report_service
from app.store import cases
from app.store.cases import Case

router = APIRouter(tags=["damage"])


@router.post("/damage/analyse", status_code=202)
async def analyse(body: AnalyseRequest, vision=Depends(get_vision),
                  asr=Depends(get_asr)) -> dict:
    case = require_case(body.case_id)
    case_service.dispatch_analysis(case, vision, asr)
    return {"status": "analysing"}


@router.get("/damage/report/{case_id}")
async def damage_report(case: Case = Depends(require_case)) -> dict:
    vehicle = cases.get_vehicle(case.vehicle_id)
    catalogue = registry.get(vehicle.slug) if vehicle and vehicle.slug else None

    report = None
    if catalogue is not None:
        evidence = evidence_service.merge(case, catalogue)
        report = orchestrator.run(
            catalogue.parts, catalogue.edges, evidence, EMPTY_HISTORY,
            conflicts=case.conflicts, rank_inspections=False,
        )
    return report_service.damage_payload(case, catalogue, report)
