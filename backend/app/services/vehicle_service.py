"""rego -> VIN -> configuration -> catalogue.

The VIN lookup is simulated from tables.rego_map; a real Partly service replaces
`resolve` and nothing else. Resolution runs in the background and reports
progress, because it can take seconds and the repairer should not be staring at
a spinner with no information (spec 4.2: 800-5000 ms).
"""

from __future__ import annotations

import asyncio
import json
import random
import time

from app.catalogue import registry
from app.config import settings
from app.store import cases
from app.store.cases import Vehicle
from app.tables.rego_map import REGO_MAP, RESOLVE_MS_MAX, RESOLVE_MS_MIN, normalise
from app.utils import sse


def start_resolution(rego: str) -> tuple[Vehicle, int]:
    """Create (or reuse) a vehicle and kick off resolution. Returns immediately."""
    key = normalise(rego)
    existing = cases.vehicle_by_rego(key)
    if existing is not None and existing.status in ("catalogue_ready", "no_catalogue", "not_found"):
        return existing, 0

    vehicle = existing or cases.create_vehicle(key)
    vehicle.status = "resolving"
    estimated = random.randint(RESOLVE_MS_MIN, RESOLVE_MS_MAX)
    asyncio.create_task(_resolve_task(vehicle, estimated))
    return vehicle, estimated


async def _resolve_task(vehicle: Vehicle, estimated_ms: int) -> None:
    started = time.perf_counter()
    await asyncio.sleep(estimated_ms / 1000.0)
    resolve(vehicle)
    vehicle.resolved_ms = int((time.perf_counter() - started) * 1000)
    sse.publish(
        vehicle.id,
        "vehicle",
        {"status": vehicle.status, "parts_indexed": vehicle.parts_indexed},
    )


def resolve(vehicle: Vehicle) -> Vehicle:
    """Synchronous resolution. Separated so tests need not wait on a timer."""
    record = REGO_MAP.get(vehicle.rego)
    if record is None:
        vehicle.status = "not_found"
        return vehicle

    slug, make, model, year, vin = record
    vehicle.make = make
    vehicle.model = model
    vehicle.year = year
    vehicle.vin = vin
    vehicle.slug = slug
    vehicle.status = "identified"

    if slug is None:
        # Make-plate only. A success case, not an error (spec 6.2).
        vehicle.status = "no_catalogue"
        return vehicle

    _load_configuration(vehicle, slug)

    catalogue = registry.ensure_loaded(slug)
    if catalogue is None:
        # Interpreter output may still exist even with no OEM catalogue.
        vehicle.status = "no_catalogue"
        return vehicle

    vehicle.parts_indexed = catalogue.parts_indexed
    vehicle.status = "catalogue_ready"
    return vehicle


def _load_configuration(vehicle: Vehicle, slug: str) -> None:
    """Pull the resolved configuration out of data/vehicles/<slug>/vehicle.json."""
    path = settings.vehicles_dir / slug / "vehicle.json"
    if not path.is_file():
        return
    try:
        payload = json.loads(path.read_text()).get("completed", {})
    except (OSError, json.JSONDecodeError):
        return

    vehicle.vin = payload.get("chassis_number") or vehicle.vin
    variants = payload.get("variants") or []
    if not variants:
        return

    properties: dict = {}
    for entry in variants[0].get("properties") or []:
        if isinstance(entry, dict):
            properties.update(entry)

    vehicle.configuration = properties
    vehicle.model_code = properties.get("model_code")
    vehicle.market = properties.get("market")
    vehicle.steering = properties.get("steering_side")
    if properties.get("production_year"):
        vehicle.year = properties["production_year"]


def catalogue_for(vehicle: Vehicle):
    return registry.get(vehicle.slug) if vehicle.slug else None
