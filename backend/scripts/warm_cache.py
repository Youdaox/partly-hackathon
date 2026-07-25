"""Pre-run every model call for every vehicle, so a demo never waits on one.

Usage:  python -m scripts.warm_cache
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.ai.vision_vlm import InterpreterVision
from app.catalogue import interpreter, registry


async def main() -> int:
    started = time.perf_counter()

    loaded = registry.preload_all()
    for slug, count in loaded.items():
        catalogue = registry.get(slug)
        print(f"  catalogue {slug:32} {count:>6} parts  "
              f"{len(catalogue.edges):>6} edges  {catalogue.load_ms:>5} ms")

    # No latency simulation while warming.
    vision = InterpreterVision(latency_s=0.0)
    for slug in registry.prediction_slugs():
        parsed = interpreter.parse(registry.prediction_for(slug) or {})
        result = await vision.analyse(slug, [])
        print(f"  interpreter {slug:30} zone={result.zone:6} side={result.side:5} "
              f"severity={result.severity}  parts={len(parsed.parts):>3}  "
              f"conflicts={len(parsed.conflicts)}")

    stats = registry.stats()
    print(
        f"\nwarm in {time.perf_counter() - started:.1f}s: "
        f"{stats['vehicles_loaded']} catalogues, {stats['parts_indexed']} parts, "
        f"{stats['edges_indexed']} edges, {stats['predictions_cached']} predictions"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
