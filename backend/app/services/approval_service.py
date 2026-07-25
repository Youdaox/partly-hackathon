"""Turn a report into something a car owner can say yes to.

A repairer reads probabilities; a customer reads money and dates. So the
approval payload drops the graph entirely and presents each part as a small set
of supply options, with everything priced marked `simulated` (spec 7.6).

`check` items are quoted too, but labelled — they are the parts the repairer has
not yet confirmed, and hiding them would mean a second phone call later.
"""

from __future__ import annotations

import time

from app.catalogue.registry import Catalogue
from app.services import supplier_service
from app.store import cases
from app.store.cases import Case

# Bucket -> how it reads to a customer.
KIND_FOR_BUCKET = {"visible": "visible", "order": "visible", "check": "hidden"}


def build_lines(report: dict, catalogue: Catalogue) -> list[dict]:
    lines: list[dict] = []

    for bucket in ("visible", "order", "check"):
        for line in report.get("sections", {}).get(bucket, []):
            part = catalogue.by_id.get(line["part_id"])
            if part is None or not part.is_orderable:
                continue

            offers = supplier_service.offers_for(part)
            lines.append(
                {
                    "part_id": part.part_id,
                    "display_name": part.name,
                    "part_number": part.part_number,
                    "kind": KIND_FOR_BUCKET[bucket],
                    "qty": line.get("qty", 1),
                    "p": line["p"],
                    "options": [
                        {
                            "id": offer.offer_id,
                            "tier": offer.kind,
                            "label": offer.supplier,
                            "price_nzd": offer.price_nzd,
                            "lead_days": offer.lead_days,
                            "in_stock": offer.in_stock,
                            "recommended": offer.recommended,
                            "why": offer.why,
                        }
                        for offer in offers
                    ],
                }
            )

    return lines


def payload(case: Case) -> dict:
    vehicle = cases.get_vehicle(case.vehicle_id)
    return {
        "case_id": case.id,
        "status": case.status,
        "vehicle": {
            "rego": vehicle.rego if vehicle else None,
            "make": vehicle.make if vehicle else None,
            "model": vehicle.model if vehicle else None,
            "year": vehicle.year if vehicle else None,
        },
        "lines": case.approval_lines,
        "approved_option": case.approved_option,
        "approved_at": case.approved_at,
        "totals": _totals(case),
        "simulated": True,
    }


def _totals(case: Case) -> dict:
    """Cheapest and recommended baskets, so the page can show a range."""
    cheapest = 0.0
    recommended = 0.0
    for line in case.approval_lines:
        options = line.get("options") or []
        if not options:
            continue
        qty = line.get("qty", 1)
        cheapest += min(o["price_nzd"] for o in options) * qty
        pick = next((o for o in options if o["recommended"]), options[0])
        recommended += pick["price_nzd"] * qty
    return {"cheapest_nzd": round(cheapest, 2), "recommended_nzd": round(recommended, 2)}


def has_option(case: Case, option_id: str) -> bool:
    return any(
        option["id"] == option_id
        for line in case.approval_lines
        for option in line.get("options") or []
    )


def approve(case: Case, option_id: str) -> None:
    case.approved_option = option_id
    case.approved_at = time.time()
    case.status = "approved"
    cases.touch(case)
