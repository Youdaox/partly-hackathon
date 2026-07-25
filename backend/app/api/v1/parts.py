"""Recommendations, offers and order finalisation (spec 6.7).

Every response carrying a price sets `simulated: true`. The supplied dataset has
no commercial data of any kind, and the UI is required to label it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_case
from app.api.errors import ApiError
from app.catalogue import registry
from app.schemas.requests import FinaliseRequest
from app.services import case_service, supplier_service
from app.store import cases
from app.store.cases import Case

router = APIRouter(tags=["parts"])


def _offer_payload(offer: supplier_service.Offer) -> dict:
    payload = {
        "offer_id": offer.offer_id,
        "supplier": offer.supplier,
        "kind": offer.kind,
        "price_nzd": offer.price_nzd,
        "lead_days": offer.lead_days,
        "in_stock": offer.in_stock,
        "recommended": offer.recommended,
    }
    if offer.why:
        payload["why"] = offer.why
    return payload


@router.get("/parts/recommendations")
async def recommendations(case_id: str = Query(...)) -> dict:
    case = require_case(case_id)
    report = case.last_report or case_service.repredict(case.id)
    if report is None:
        raise ApiError("prediction_unavailable", "no prediction for this case")

    vehicle = cases.get_vehicle(case.vehicle_id)
    catalogue = registry.get(vehicle.slug) if vehicle and vehicle.slug else None
    if catalogue is None:
        raise ApiError("catalogue_unavailable", "no OEM catalogue for this vehicle")

    lines = []
    for bucket in ("visible", "order", "check"):
        for line in report["sections"][bucket]:
            part = catalogue.by_id.get(line["part_id"])
            if part is None:
                continue
            offers = supplier_service.offers_for(part)
            lines.append(
                {
                    "part_id": part.part_id,
                    "part_number": part.part_number,
                    "name": part.name,
                    "p": line["p"],
                    "bucket": bucket,
                    "qty": line.get("qty", 1),
                    "offers": [_offer_payload(offer) for offer in offers],
                }
            )

    return {"lines": lines, "simulated": True}


@router.get("/parts/{part_id}/offers")
async def offers(part_id: str, case_id: str | None = Query(default=None)) -> dict:
    part = None
    if case_id:
        case = require_case(case_id)
        vehicle = cases.get_vehicle(case.vehicle_id)
        catalogue = registry.get(vehicle.slug) if vehicle and vehicle.slug else None
        if catalogue is not None:
            part = catalogue.by_id.get(part_id)
    else:
        for slug in registry.available_slugs():
            catalogue = registry.get(slug)
            if catalogue and part_id in catalogue.by_id:
                part = catalogue.by_id[part_id]
                break

    if part is None:
        raise ApiError("vehicle_not_found", f"part {part_id} is not in any loaded catalogue")

    return {
        "part_id": part.part_id,
        "offers": [_offer_payload(offer) for offer in supplier_service.offers_for(part)],
        "simulated": True,
    }


@router.post("/parts/finalise")
async def finalise(body: FinaliseRequest) -> dict:
    case = require_case(body.case_id)
    vehicle = cases.get_vehicle(case.vehicle_id)
    catalogue = registry.get(vehicle.slug) if vehicle and vehicle.slug else None
    if catalogue is None:
        raise ApiError("catalogue_unavailable", "no OEM catalogue for this vehicle")

    report = case.last_report or {}
    bucket_of: dict[str, str] = {}
    for bucket in ("visible", "order", "check"):
        for line in report.get("sections", {}).get(bucket, []):
            bucket_of[line["part_id"]] = bucket

    total = 0.0
    accepted = 0
    persisted = []

    for line in body.lines:
        part = catalogue.by_id.get(line.part_id)
        if part is None:
            continue
        record = {
            "part_id": line.part_id,
            "action": line.action,
            "qty": line.qty,
            "offer_id": line.offer_id,
            "from_bucket": bucket_of.get(line.part_id),
        }
        if line.action == "accept":
            chosen = next(
                (o for o in supplier_service.offers_for(part) if o.offer_id == line.offer_id),
                None,
            )
            if chosen is None:
                chosen = next(
                    o for o in supplier_service.offers_for(part) if o.recommended
                )
            record["price_nzd"] = chosen.price_nzd
            total += chosen.price_nzd * line.qty
            accepted += 1
        persisted.append(record)

    order = {
        "order_id": cases.new_id("ord"),
        "state": "placed",
        "line_count": accepted,
        "total_nzd": round(total, 2),
        "simulated": True,
        # Rejections are kept: they are the negative training signal and the
        # most valuable thing this app could collect at scale (spec 6.7).
        "lines": persisted,
    }
    case.order = order
    case.status = "ordered"
    cases.touch(case)
    return order
