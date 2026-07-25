"""Probabilities -> the sections a repairer actually sees (spec 9.6).

| Rule              | Action                                        |
|-------------------|-----------------------------------------------|
| p >= 0.60         | order — add to basket                         |
| 0.15 <= p < 0.60  | check — surface, ranked by inspection value   |
| p < 0.15          | ignore — never shown                          |

visible        observed parts, in the Interpreter's order, cap 12
order          p >= ORDER_MIN and not visible, desc, cap 8
check          CHECK_MIN <= p < ORDER_MIN, hard cap 5, ordered by what you
               *learn* by checking rather than by what is likely
inspect_first  top MAX_INSPECT accessible inspections
hidden         counted but never shown

Confirmed-damaged parts join `visible`: the repairer has looked at them, which
is as observed as observation gets — and it is what makes a ✓ visibly promote
the part on the phone.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.engines.types import Inspection, Part, Prediction
from app.tables.constants import (
    CAP_ORDER,
    CAP_VISIBLE,
    CHECK_MIN,
    MAX_CHECK,
    MAX_INSPECT,
    ORDER_MIN,
)


@dataclass(slots=True)
class Sections:
    visible: list[Prediction] = field(default_factory=list)
    order: list[Prediction] = field(default_factory=list)
    check: list[Prediction] = field(default_factory=list)
    inspect_first: list[Inspection] = field(default_factory=list)
    hidden_count: int = 0


def _dedupe(predictions: list[Prediction], parts: dict[str, Part]) -> tuple[list[Prediction], int]:
    """Collapse rows that name the same physical component, keeping the
    strongest probability.

    The catalogue lists a part once per fitted position, so a front corner can
    carry "Right Front Guard Grommet" under six different part ids. Before this
    ran, six duplicate rows at p=1.0 could fill every CAP_ORDER slot ahead of a
    real, distinct part sitting at p=0.98 right behind them — found by checking
    a real Yaris report rather than trusting the unit tests in isolation.
    Dedup must happen *before* the cap, which is why it lives here rather than
    only in report_service (which used to run it after the cut had already
    happened).
    """
    best: dict[tuple[str, str | None], Prediction] = {}
    order: list[tuple[str, str | None]] = []
    dropped = 0
    for prediction in predictions:
        part = parts.get(prediction.part_id)
        if part is None:
            continue
        key = (part.name, part.part_number)
        if key not in best:
            best[key] = prediction
            order.append(key)
        else:
            dropped += 1
            if prediction.p > best[key].p:
                best[key] = prediction
    return [best[key] for key in order], dropped


def split(
    predictions: dict[str, Prediction],
    parts: dict[str, Part],
    inspections: list[Inspection] | None = None,
) -> Sections:
    inspection_by_id = {item.part_id: item for item in (inspections or [])}

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

        if prediction.p >= ORDER_MIN:
            order.append(prediction)
        elif prediction.p >= CHECK_MIN:
            check_pool.append(prediction)
        else:
            hidden += 1

    # Dedupe before sorting and before the caps below — a cap that sees
    # duplicate rows first gives its slots to the same component six times.
    visible, dropped_visible = _dedupe(visible, parts)
    order, dropped_order = _dedupe(order, parts)
    check_pool, dropped_check = _dedupe(check_pool, parts)
    hidden += dropped_visible + dropped_order + dropped_check

    # Observed parts keep the Interpreter's own ordering (insertion order of
    # the predictions dict follows the sweep, so sort by p as the stable proxy
    # the client can rely on).
    visible.sort(key=lambda p: p.p, reverse=True)
    order.sort(key=lambda p: p.p, reverse=True)

    # `check` is ordered by what you learn, not by what is likely.
    check_pool.sort(
        key=lambda p: (
            inspection_by_id[p.part_id].value if p.part_id in inspection_by_id else 0.0,
            p.p,
        ),
        reverse=True,
    )

    inspect_first = [
        item for item in (inspections or []) if item.accessible
    ][:MAX_INSPECT]

    hidden += max(0, len(visible) - CAP_VISIBLE)
    hidden += max(0, len(order) - CAP_ORDER)
    hidden += max(0, len(check_pool) - MAX_CHECK)

    return Sections(
        visible=visible[:CAP_VISIBLE],
        order=order[:CAP_ORDER],
        check=check_pool[:MAX_CHECK],
        inspect_first=inspect_first,
        hidden_count=hidden,
    )
