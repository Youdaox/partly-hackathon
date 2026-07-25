"""Engine output -> the canonical report payload of spec 6.6.

Two jobs beyond plain serialisation.

Deduplication: the catalogue lists a part once per fitted position, so a front
corner can contain five rows all called "Right Front Guard Grommet" with
different part ids. Five identical lines is not a report anyone reads, so
identical (name, part_number) pairs collapse into one line carrying a quantity.
The engine still reasons over them separately — this is presentation only.

Payload size: spec 6.8 caps the response at 20 KB, which the section caps plus
attribution truncation keep it under.
"""

from __future__ import annotations

from app.catalogue import registry
from app.catalogue.registry import Catalogue
from app.engines.orchestrator import Report
from app.engines.types import Inspection, Part, Prediction
from app.store.cases import Case, Vehicle

MAX_ATTRIBUTION = 3


def _line(part: Part, prediction: Prediction, qty: int, slug: str | None = None) -> dict:
    line: dict = {
        "part_id": part.part_id,
        "part_number": part.part_number,
        "name": part.name,
        "p": round(prediction.p, 3),
        "qty": qty,
    }
    if part.diagram_id:
        line["diagram_id"] = part.diagram_id
        # Only a subset of diagrams ship image assets, so say which: the client
        # must not render a hotspot over an image that will 404.
        line["diagram_available"] = registry.has_diagram_image(slug, part.diagram_id)
    if part.hotspot:
        line["hotspot"] = list(part.hotspot)
    return line


def _dedupe(
    predictions: list[Prediction],
    catalogue: Catalogue,
) -> list[tuple[Part, Prediction, int]]:
    """Collapse identically-named parts, keeping the strongest probability."""
    grouped: dict[tuple[str, str | None], tuple[Part, Prediction, int]] = {}
    order: list[tuple[str, str | None]] = []

    for prediction in predictions:
        part = catalogue.by_id.get(prediction.part_id)
        if part is None:
            continue
        key = (part.name, part.part_number)
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = (part, prediction, part.quantity)
            order.append(key)
        else:
            kept_part, kept_prediction, qty = existing
            best = prediction if prediction.p > kept_prediction.p else kept_prediction
            best_part = part if prediction.p > kept_prediction.p else kept_part
            grouped[key] = (best_part, best, qty + part.quantity)

    return [grouped[key] for key in order]


def build(
    case: Case,
    vehicle: Vehicle,
    catalogue: Catalogue | None,
    report: Report | None,
) -> dict:
    payload: dict = {
        "case_id": case.id,
        "status": case.status,
        "vehicle": vehicle_payload(vehicle),
        "impact": {
            "zone": case.zone,
            "side": case.side,
            "severity": case.severity,
        },
        "question": None,
        "sections": {"visible": [], "order": [], "check": []},
    }

    if report is None or catalogue is None:
        payload["degraded"] = catalogue is None
        return payload

    inspections: dict[str, Inspection] = {i.part_id: i for i in report.inspections}

    slug = catalogue.slug
    payload["sections"]["visible"] = [
        _line(part, prediction, qty, slug)
        for part, prediction, qty in _dedupe(report.sections.visible, catalogue)
    ]

    order_lines = []
    for part, prediction, qty in _dedupe(report.sections.order, catalogue):
        line = _line(part, prediction, qty, slug)
        line["reason"] = prediction.reason
        order_lines.append(line)
    payload["sections"]["order"] = order_lines

    check_lines = []
    for part, prediction, qty in _dedupe(report.sections.check, catalogue):
        line = _line(part, prediction, qty, slug)
        line["reason"] = prediction.reason
        line["confirmed"] = case.confirmations.get(part.part_id)
        inspection = inspections.get(part.part_id)
        if inspection is not None:
            line["inspection_rank"] = inspection.rank
            line["inspection_value"] = inspection.value
            line["accessible"] = inspection.accessible
        line["attribution"] = [
            {"cause": cause.cause, "relation": cause.relation, "share": cause.share}
            for cause in prediction.attribution[:MAX_ATTRIBUTION]
        ]
        check_lines.append(line)
    payload["sections"]["check"] = check_lines

    if report.question is not None:
        payload["question"] = {
            "id": report.question.id,
            "text": report.question.text,
            "options": report.question.options,
            "value": report.question.value,
        }

    payload["hidden_count"] = report.sections.hidden_count
    payload["computed_ms"] = report.computed_ms
    payload["candidates"] = report.candidates
    return payload


def vehicle_payload(vehicle: Vehicle) -> dict:
    return {
        "vehicle_id": vehicle.id,
        "status": vehicle.status,
        "rego": vehicle.rego,
        "vin": vehicle.vin,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
        "model_code": vehicle.model_code,
        "market": vehicle.market,
        "steering": vehicle.steering,
        "parts_indexed": vehicle.parts_indexed,
        "resolved_ms": vehicle.resolved_ms,
    }


def damage_payload(case: Case, catalogue: Catalogue | None, report: Report | None) -> dict:
    """The visible-damage layer of spec 6.5."""
    visible: list[dict] = []
    if report is not None and catalogue is not None:
        sources_by_part: dict[str, set[str]] = {}
        for observation in case.observations:
            if observation.part_id:
                sources_by_part.setdefault(observation.part_id, set()).add(observation.source)
        for part, prediction, qty in _dedupe(report.sections.visible, catalogue):
            line = _line(part, prediction, qty, catalogue.slug)
            line["sources"] = sorted(sources_by_part.get(part.part_id, set()))
            visible.append(line)

    return {
        "case_id": case.id,
        "impact": {
            "zone": case.zone,
            "side": case.side,
            "severity": case.severity,
            "evidence": case.impact_evidence,
            "confidence": case.impact_confidence,
        },
        "visible": visible,
        "conflicts": case.conflicts,
    }
