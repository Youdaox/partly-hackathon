"""Engine output -> the canonical report payload of spec 6.6.

Deduplication and hardware grouping both happen upstream in `engines.buckets`,
before the section caps, because a cap that sees six copies of one grommet
gives six slots to one grommet. This module serialises what it is handed and
adds the catalogue lookups (diagram, hotspot) the engine has no business
knowing about.

Payload size: spec 6.8 caps the response at 20 KB, which the section caps plus
attribution truncation keep it under.
"""

from __future__ import annotations

from app.catalogue import registry
from app.catalogue.registry import Catalogue
from app.engines.orchestrator import Report
from app.engines.types import Inspection, Part, Prediction
from app.services import media_service
from app.store import cases
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


def _region_hint(part: Part) -> dict:
    """Already tagged on every part at load time (catalogue/tagger.py) — exposed on
    top-level lines only, so a client can place a part on something physical (a 3D
    region, a zone map) without re-guessing it from the display name.

    `zone` is left off: it is redundant with the report's own `impact.zone` for
    all but a handful of klasses (front vs rear bumper hardware), which a client
    can default to the impact zone for. Left off hardware and consumable lines
    entirely: those can number in the dozens per case and the client never needs
    to place a clip on the model, so adding two fields to each would burn a real
    chunk of the 20 KB payload cap (spec 6.8) for no reader.
    """
    return {"side": part.side, "klass": part.klass}


def _attribution(prediction: Prediction) -> list[dict]:
    """The causes behind one probability, strongest first."""
    return [
        {"cause": cause.cause, "relation": cause.relation, "share": cause.share}
        for cause in prediction.attribution[:MAX_ATTRIBUTION]
    ]


def _rows(
    predictions: list[Prediction],
    catalogue: Catalogue,
    quantity: dict[str, int] | None = None,
) -> list[tuple[Part, Prediction, int]]:
    """Pair each prediction with its part and the quantity buckets computed."""
    quantity = quantity or {}
    rows = []
    for prediction in predictions:
        part = catalogue.by_id.get(prediction.part_id)
        if part is not None:
            rows.append((part, prediction, quantity.get(part.part_id, part.quantity)))
    return rows


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
        "consumables": [],
        # What the repairer uploaded. Recorded and listed only — the prediction
        # comes from the shipped Interpreter output, not from these frames.
        "media": [media_service.payload(asset) for asset in cases.uploaded_media(case)],
    }

    if report is None or catalogue is None:
        payload["degraded"] = catalogue is None
        return payload

    inspections: dict[str, Inspection] = {i.part_id: i for i in report.inspections}
    sections = report.sections
    quantity = sections.quantity

    slug = catalogue.slug

    def hardware_for(part: Part) -> list[dict]:
        """The fasteners and sub-components that come with one line."""
        return [
            _line(child_part, child, child_qty, slug)
            for child_part, child, child_qty in _rows(
                sections.hardware.get(part.part_id, []), catalogue, quantity
            )
        ]

    visible_lines = []
    for part, prediction, qty in _rows(sections.visible, catalogue, quantity):
        line = _line(part, prediction, qty, slug)
        line.update(_region_hint(part))
        line["hardware"] = hardware_for(part)
        visible_lines.append(line)
    payload["sections"]["visible"] = visible_lines

    order_lines = []
    for part, prediction, qty in _rows(sections.order, catalogue, quantity):
        line = _line(part, prediction, qty, slug)
        line.update(_region_hint(part))
        line["reason"] = prediction.reason
        line["hardware"] = hardware_for(part)
        # The decomposition behind `reason`, so the client can show the whole
        # chain rather than only the strongest link.
        line["attribution"] = _attribution(prediction)
        order_lines.append(line)
    payload["sections"]["order"] = order_lines

    # Fasteners whose parent is not in the report. One group beats N lines that
    # all say "a clip from the front of the car". Kept out of `sections` so the
    # spec 6.6 triple stays exactly the triple the client already parses.
    payload["consumables"] = [
        _line(part, prediction, qty, slug)
        for part, prediction, qty in _rows(sections.consumables, catalogue, quantity)
    ]

    check_lines = []
    for part, prediction, qty in _rows(sections.check, catalogue, quantity):
        line = _line(part, prediction, qty, slug)
        line.update(_region_hint(part))
        line["reason"] = prediction.reason
        line["confirmed"] = case.confirmations.get(part.part_id)
        inspection = inspections.get(part.part_id)
        if inspection is not None:
            line["inspection_rank"] = inspection.rank
            line["inspection_value"] = inspection.value
            line["accessible"] = inspection.accessible
        line["attribution"] = _attribution(prediction)
        check_lines.append(line)
    payload["sections"]["check"] = check_lines

    # A klass the repairer raised and could not settle outranks any question the
    # counterfactual invents, because they already have it on their mind (8.3).
    raised = _raised_question(case, catalogue)
    if raised is not None:
        payload["question"] = raised
    elif report.question is not None:
        payload["question"] = {
            "id": report.question.id,
            "text": report.question.text,
            "options": report.question.options,
            "value": report.question.value,
        }

    # The top accessible inspections (spec 9.6): what to physically look at
    # first, with the parts each answer would settle.
    payload["inspect_first"] = [
        {
            "part_id": item.part_id,
            "name": catalogue.by_id[item.part_id].name,
            "value": item.value,
            "informs": len(item.informs),
        }
        for item in report.sections.inspect_first
        if item.part_id in catalogue.by_id
    ]

    payload["hidden_count"] = report.sections.hidden_count
    payload["computed_ms"] = report.computed_ms
    payload["candidates"] = report.candidates
    return payload


# Plain-English names for the classes a repairer hedges about most.
_KLASS_LABEL = {
    "side_member": "the chassis rail",
    "suspension_arm": "the suspension",
    "strut_tower": "the strut tower",
    "radiator": "the radiator",
    "condenser": "the condenser",
    "reinforcement_beam": "the reinforcement bar",
    "subframe": "the subframe",
    "steering_rack": "the steering",
    "wheel_hub": "the wheel bearing",
    "airbag_module": "the airbags",
}


def _raised_question(case: Case, catalogue: Catalogue) -> dict | None:
    """Turn an unsettled spoken mention into the next question."""
    for klass in case.question_candidates:
        if any(
            case.confirmations.get(part.part_id) is not None
            for part in catalogue.parts
            if part.klass == klass
        ):
            continue  # already resolved by an inspection
        label = _KLASS_LABEL.get(klass, klass.replace("_", " "))
        return {
            "id": f"q_raised_{klass}",
            "text": f"You weren't sure about {label} — can you take a look?",
            "options": ["Damaged", "Looks fine", "Can't get to it"],
            "value": 1.0,
            "source": "repairer",
        }
    return None


def vehicle_payload(vehicle: Vehicle) -> dict:
    return {
        "vehicle_id": vehicle.id,
        "slug": vehicle.slug,
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
        # The prediction is a walk over these, so the client can say what was
        # actually loaded rather than just how many parts exist.
        "edges_indexed": vehicle.edges_indexed,
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
        for part, prediction, qty in _rows(
            report.sections.visible, catalogue, report.sections.quantity
        ):
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
