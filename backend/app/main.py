"""App factory, lifespan, boot preload.

Startup loads and tags every catalogue on disk *before* the port is bound, so
nothing lazy-loads on the hot path (spec 4.5). Tagging 7,009 parts takes ~300 ms
per vehicle; doing it inside a request would blow every budget in spec 4.2.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai import cache
from app.api import errors
from app.api.v1 import audio, case, damage, media, parts, prediction, vehicle, vehicles
from app.catalogue import registry
from app.config import settings
from app.store import cases

logger = logging.getLogger("partli")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.preload_catalogues:
        loaded = registry.preload_all()
        logger.info("preloaded %d catalogues: %s", len(loaded), loaded)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Partli damage-to-parts API",
        version="0.1.0",
        lifespan=lifespan,
    )

    # The Expo client runs from a phone on the LAN.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    errors.install(app)

    for router in (
        vehicle.router,
        case.router,
        media.router,
        audio.router,
        damage.router,
        prediction.router,
        parts.router,
        vehicles.router,
    ):
        app.include_router(router, prefix="/v1")

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict:
        stats = registry.stats()
        return {
            "status": "ok",
            "vehicles_loaded": stats["vehicles_loaded"],
            "parts_indexed": stats["parts_indexed"],
            "edges_indexed": stats["edges_indexed"],
            "cache_entries": cache.entries(),
            **cases.stats(),
        }

    return app


app = create_app()
