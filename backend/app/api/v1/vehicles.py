"""Catalogue index and diagram assets (spec 6.1).

Diagram images are never inlined in a report — they are 18-42 MB per vehicle —
and are served immutable so the client and any CDN cache them permanently.
"""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from app.api.errors import ApiError
from app.catalogue import registry
from app.tables.rego_map import REGO_MAP

router = APIRouter(tags=["vehicles"])

IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


@router.get("/vehicles")
async def list_vehicles() -> dict:
    by_slug = {
        slug: (rego, make, model, year)
        for rego, (slug, make, model, year, _vin) in REGO_MAP.items()
        if slug
    }
    catalogued = set(registry.available_slugs())

    vehicles = []
    for slug, (rego, make, model, year) in sorted(by_slug.items()):
        vehicles.append(
            {
                "slug": slug,
                "rego": rego,
                "make": make,
                "model": model,
                "year": year,
                "has_prediction": registry.has_prediction(slug),
                "has_catalogue": slug in catalogued,
            }
        )
    return {"vehicles": vehicles}


@router.get("/vehicles/{slug}/diagrams/{diagram_id}/image")
async def diagram_image(slug: str, diagram_id: str) -> FileResponse:
    path = registry.diagram_dir(slug, diagram_id) / "image.webp"
    if not path.is_file():
        raise ApiError("vehicle_not_found", f"no diagram {diagram_id} for {slug}")
    return FileResponse(path, media_type="image/webp", headers=IMMUTABLE)


@router.get("/vehicles/{slug}/diagrams/{diagram_id}/annotations")
async def diagram_annotations(slug: str, diagram_id: str) -> JSONResponse:
    path = registry.diagram_dir(slug, diagram_id) / "annotations.json"
    if not path.is_file():
        raise ApiError("vehicle_not_found", f"no annotations for {diagram_id}")
    return JSONResponse(json.loads(path.read_text()), headers=IMMUTABLE)


@router.get("/vehicles/{slug}/diagrams/{diagram_id}/meta")
async def diagram_meta(slug: str, diagram_id: str) -> JSONResponse:
    path = registry.diagram_dir(slug, diagram_id) / "meta.json"
    if not path.is_file():
        raise ApiError("vehicle_not_found", f"no meta for {diagram_id}")
    return JSONResponse(json.loads(path.read_text()), headers=IMMUTABLE)
