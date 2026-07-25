"""In-memory catalogue mirror, preloaded at boot (spec 4.3, 4.5).

One entry per vehicle slug. Loading a 2.9 MB assemblies.json and tagging 7,009
parts is far too slow to do on a request, so `preload_all` runs during the
lifespan startup hook and the port is not bound until it finishes.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.catalogue import edges as edge_builder
from app.catalogue import loader
from app.config import settings
from app.engines.types import Edge, Part


@dataclass(slots=True)
class Catalogue:
    slug: str
    parts: list[Part]
    edges: list[Edge]
    diagrams: dict[str, dict] = field(default_factory=dict)
    by_id: dict[str, Part] = field(default_factory=dict)
    load_ms: int = 0

    @property
    def parts_indexed(self) -> int:
        return len(self.parts)


_lock = threading.RLock()
_catalogues: dict[str, Catalogue] = {}
_predictions: dict[str, dict] = {}


def available_slugs() -> list[str]:
    """Slugs with an assemblies.json on disk."""
    root = settings.vehicles_dir
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if (p / "assemblies.json").is_file())


def prediction_slugs() -> list[str]:
    root = settings.predictions_dir
    if not root.is_dir():
        return []
    return sorted(p.stem for p in root.glob("*.json"))


def load(slug: str) -> Catalogue | None:
    """Load and tag one vehicle. Returns None when it has no OEM catalogue."""
    path = settings.vehicles_dir / slug / "assemblies.json"
    if not path.is_file():
        return None

    started = time.perf_counter()
    raw = loader.load_raw(path)
    parts = loader.build_parts(raw)
    diagrams = loader.build_diagrams(raw)
    built = edge_builder.build_edges(parts, loader.sub_assembly_links(raw))
    elapsed = int((time.perf_counter() - started) * 1000)

    return Catalogue(
        slug=slug,
        parts=parts,
        edges=built,
        diagrams=diagrams,
        by_id={part.part_id: part for part in parts},
        load_ms=elapsed,
    )


def ensure_loaded(slug: str) -> Catalogue | None:
    with _lock:
        if slug in _catalogues:
            return _catalogues[slug]
    catalogue = load(slug)
    if catalogue is None:
        return None
    with _lock:
        _catalogues[slug] = catalogue
    return catalogue


def get(slug: str) -> Catalogue | None:
    with _lock:
        return _catalogues.get(slug)


def preload_all() -> dict[str, int]:
    """Load every catalogue on disk. Called from the lifespan startup hook."""
    result: dict[str, int] = {}
    for slug in available_slugs():
        catalogue = ensure_loaded(slug)
        if catalogue is not None:
            result[slug] = catalogue.parts_indexed
    return result


# --- Interpreter output -----------------------------------------------------

def prediction_for(slug: str) -> dict | None:
    """data/predictions/<slug>.json, cached for the process lifetime (spec 4.3)."""
    with _lock:
        if slug in _predictions:
            return _predictions[slug]
    path = settings.predictions_dir / f"{slug}.json"
    if not path.is_file():
        return None
    with path.open("rb") as handle:
        payload = json.load(handle)
    with _lock:
        _predictions[slug] = payload
    return payload


def has_prediction(slug: str) -> bool:
    return (settings.predictions_dir / f"{slug}.json").is_file()


def diagram_dir(slug: str, diagram_id: str) -> Path:
    return settings.vehicles_dir / slug / "diagrams" / diagram_id


@lru_cache(maxsize=32)
def _diagrams_on_disk(slug: str) -> frozenset[str]:
    root = settings.vehicles_dir / slug / "diagrams"
    if not root.is_dir():
        return frozenset()
    return frozenset(p.name for p in root.iterdir() if (p / "image.webp").is_file())


def has_diagram_image(slug: str, diagram_id: str | None) -> bool:
    """Only a subset of diagrams ship assets — 50 of the Yaris's 187.

    The report says which, so the client never requests an image that 404s.
    """
    if not diagram_id:
        return False
    return diagram_id in _diagrams_on_disk(slug)


def stats() -> dict:
    with _lock:
        return {
            "vehicles_loaded": len(_catalogues),
            "parts_indexed": sum(c.parts_indexed for c in _catalogues.values()),
            "edges_indexed": sum(len(c.edges) for c in _catalogues.values()),
            "predictions_cached": len(_predictions),
        }


def reset() -> None:
    """Test hook."""
    with _lock:
        _catalogues.clear()
        _predictions.clear()
