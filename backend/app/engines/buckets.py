"""Probabilities -> the three sections a repairer actually sees.

visible  we can see it is damaged, from a photo or from what they told us
order    high enough that putting it on the order now is the cheaper mistake
check    genuinely uncertain, and worth someone walking over to look
hidden   below the floor; counted but never shown

The caps are hard (spec 6.8). A `check` list of twenty items is a list nobody
reads, so it is capped at five and ordered by inspection value rather than by
probability — the most *informative* checks, not the most likely ones.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.engines.types import Inspection, Part, Prediction
from app.tables.constants import (
    CAP_CHECK,
    CAP_ORDER,
    CAP_VISIBLE,
    CHECK_MIN,
    ORDER_THRESHOLD,
)


@dataclass(slots=True)
class Sections:
    visible: list[Prediction] = field(default_factory=list)
    order: list[Prediction] = field(default_factory=list)
    check: list[Prediction] = field(default_factory=list)
    hidden_count: int = 0


def split(
    predictions: dict[str, Prediction],
    parts: dict[str, Part],
    inspections: list[Inspection] | None = None,
) -> Sections:
    inspection_rank = {item.part_id: item for item in (inspections or [])}

    visible: list[Prediction] = []
    order: list[Prediction] = []
    check_pool: list[Prediction] = []
    hidden = 0

    for pid, prediction in predictions.items():
        part = parts.get(pid)
        if part is None:
            continue

        # Inspected and found clean: gone from the report entirely.
        if prediction.confirmed is False:
            continue

        if prediction.observed or prediction.confirmed is True:
            visible.append(prediction)
            continue

        if not part.is_orderable:
            # Cannot be ordered on its own, so it is never an order line.
            hidden += 1
            continue

        if prediction.p >= ORDER_THRESHOLD:
            order.append(prediction)
        elif prediction.p >= CHECK_MIN:
            check_pool.append(prediction)
        else:
            hidden += 1

    visible.sort(key=lambda p: p.p, reverse=True)
    order.sort(key=lambda p: p.p, reverse=True)

    # `check` is ordered by what you learn, not by what is likely.
    check_pool.sort(
        key=lambda p: (
            inspection_rank[p.part_id].value if p.part_id in inspection_rank else 0.0,
            p.p,
        ),
        reverse=True,
    )

    hidden += max(0, len(visible) - CAP_VISIBLE)
    hidden += max(0, len(order) - CAP_ORDER)
    hidden += max(0, len(check_pool) - CAP_CHECK)

    return Sections(
        visible=visible[:CAP_VISIBLE],
        order=order[:CAP_ORDER],
        check=check_pool[:CAP_CHECK],
        hidden_count=hidden,
    )
