"""Vehicle registration and lookup (spec 6.2). HTTP only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.api.deps import require_vehicle
from app.api.errors import ApiError
from app.schemas.requests import RegisterVehicleRequest
from app.services import report_service, vehicle_service
from app.store.cases import Vehicle
from app.tables import rego_map
from app.tables.rego_map import REGO_MAP, normalise

router = APIRouter(tags=["vehicle"])


@router.get("/vehicles/allowed")
async def list_allowed() -> dict:
    """The registrations `/vehicle/register` will accept.

    Exists so the client can render the picker without hardcoding the three
    plates, and so the list stays in one place when a fourth catalogue lands.
    """
    return {"vehicles": rego_map.allowed_vehicles()}


@router.post("/vehicle/register", status_code=202)
async def register(body: RegisterVehicleRequest, response: Response) -> dict:
    rego = normalise(body.rego)
    if rego not in REGO_MAP:
        raise ApiError("rego_not_found", f"{body.rego} is not a known registration")
    if rego not in rego_map.ALLOWED_REGOS:
        raise ApiError(
            "rego_not_allowed",
            f"{body.rego} has no parts catalogue, so hidden damage cannot be "
            f"predicted for it. Try one of: {rego_map.allowed_summary()}.",
        )

    vehicle, estimated = vehicle_service.start_resolution(rego)
    if estimated == 0:
        response.status_code = 200
    return {
        "vehicle_id": vehicle.id,
        "rego": vehicle.rego,
        "status": vehicle.status,
        "estimated_ms": estimated,
    }


@router.get("/vehicle/{vehicle_id}")
async def get_vehicle(vehicle: Vehicle = Depends(require_vehicle)) -> dict:
    return report_service.vehicle_payload(vehicle)
