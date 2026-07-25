"""ASR phrase hints drawn from the loaded catalogue (spec 8.3).

Once VIN resolution completes we hold ~7,000 part names for *this exact
vehicle*. Passing the impact-zone names to the ASR as phrase hints is a real
accuracy gain that falls out of the parallel VIN workflow for free: "slam
panel", "crash box", "guard liner" and "MacPherson" are not in a general
model's comfortable vocabulary, and a repairer says them constantly.

Hints are ranked by how likely the part is to come up in conversation — shallow,
orderable, in the impact zone — not by catalogue order.
"""

from __future__ import annotations

from functools import lru_cache

from app.catalogue.registry import Catalogue

# Most ASR APIs degrade or reject beyond a few hundred hints.
MAX_HINTS = 200

# Workshop terms that are not in the catalogue but are said constantly. Worth
# biasing towards regardless of vehicle.
TRADE_TERMS = [
    "slam panel", "crash box", "guard liner", "reo", "rad support",
    "macpherson strut", "shut line", "chassis rail", "subframe",
    "quarter panel", "A-pillar", "bumper cover", "impact absorber",
    "headlamp bracket", "wheel arch", "sill", "tailgate",
]


@lru_cache(maxsize=64)
def _catalogue_terms(slug: str, zone: str) -> tuple[str, ...]:
    from app.catalogue import registry

    catalogue: Catalogue | None = registry.get(slug)
    if catalogue is None:
        return ()

    scored: list[tuple[tuple[int, int, str], str]] = []
    seen: set[str] = set()

    for part in catalogue.parts:
        if part.zone != zone:
            continue
        name = part.name.strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        # Shallow and orderable first: those are the parts a repairer names.
        scored.append(((part.depth, 0 if part.is_orderable else 1, name), name))

    scored.sort(key=lambda item: item[0])
    return tuple(name for _, name in scored)


def phrase_hints(slug: str | None, zone: str = "front", limit: int = MAX_HINTS) -> list[str]:
    """Top part names for this vehicle and impact zone, plus trade slang."""
    hints = list(TRADE_TERMS)
    if slug:
        hints.extend(_catalogue_terms(slug, zone))

    # Preserve order, drop duplicates, then truncate.
    out: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        key = hint.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(hint)
        if len(out) >= limit:
            break
    return out


def reset() -> None:
    """Test hook — the catalogue cache is keyed by slug, so clear alongside it."""
    _catalogue_terms.cache_clear()
