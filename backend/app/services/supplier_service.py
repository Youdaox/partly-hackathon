"""Offers, availability and a recommendation.

The supplied dataset contains no price, lead-time, stock or supplier field of
any kind — verified across every part record — so every number here is
generated. `simulated: true` is set on every response that carries one and the
flag is not optional (spec 7.6).

Generation is deterministic on part_id so a demo shows the same prices twice,
and prices are anchored to the part's depth and class rather than random: a
bumper cover should cost more than a clip.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.engines.types import Part

SUPPLIERS = [
    {"id": "sup_oem", "name": "Toyota NZ", "kind": "oem", "reliability": 0.96},
    {"id": "sup_am1", "name": "AllParts", "kind": "aftermarket", "reliability": 0.88},
    {"id": "sup_am2", "name": "Repco Trade", "kind": "aftermarket", "reliability": 0.82},
]

# Indicative OEM price band by depth, in NZD.
BASE_PRICE_BY_DEPTH = {0: 420.0, 1: 310.0, 2: 28.0, 3: 96.0, 4: 240.0, 5: 180.0, 6: 260.0}
CONSUMABLE_PRICE = 9.50


@dataclass(slots=True)
class Offer:
    offer_id: str
    supplier: str
    kind: str
    price_nzd: float
    lead_days: int
    in_stock: bool
    recommended: bool = False
    why: str | None = None


def _seed(part_id: str) -> int:
    return int(hashlib.sha256(part_id.encode()).hexdigest()[:8], 16)


def offers_for(part: Part, deadline_days: int | None = None) -> list[Offer]:
    seed = _seed(part.part_id)

    if part.leak_class == "consumable":
        base = CONSUMABLE_PRICE * (1.0 + (seed % 40) / 100.0)
    else:
        base = BASE_PRICE_BY_DEPTH.get(part.depth, 120.0) * (0.75 + (seed % 60) / 100.0)

    result: list[Offer] = []
    for index, supplier in enumerate(SUPPLIERS):
        bump = seed >> (index * 3)
        if supplier["kind"] == "oem":
            price = base
            lead = 2 + bump % 4
            in_stock = bump % 5 != 0
        else:
            price = base * (0.55 + (bump % 25) / 100.0)
            lead = 4 + bump % 8
            in_stock = bump % 4 != 0

        result.append(
            Offer(
                offer_id=f"off_{part.part_id[:8]}_{supplier['id'][-3:]}",
                supplier=supplier["name"],
                kind=supplier["kind"],
                price_nzd=round(price, 2),
                lead_days=lead,
                in_stock=in_stock,
                )
        )

    _recommend(result, deadline_days)
    return result


def _recommend(offers: list[Offer], deadline_days: int | None) -> None:
    """Cheapest offer that actually arrives in time, else the fastest in stock.

    A deadline changes the answer: without one, price wins; with one, an
    aftermarket part that misses the date is worthless however cheap it is.
    """
    if not offers:
        return

    viable = [o for o in offers if o.in_stock]
    if deadline_days is not None:
        in_time = [o for o in viable if o.lead_days <= deadline_days]
        if in_time:
            best = min(in_time, key=lambda o: o.price_nzd)
            best.recommended = True
            best.why = f"in stock, arrives in {best.lead_days} days, inside your deadline"
            return
        if viable:
            best = min(viable, key=lambda o: o.lead_days)
            best.recommended = True
            best.why = f"fastest available, but {best.lead_days} days misses your deadline"
            return

    pool = viable or offers
    best = min(pool, key=lambda o: o.price_nzd)
    best.recommended = True
    best.why = "cheapest option in stock" if best.in_stock else "cheapest option, on backorder"
