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

Two things stand between the raw probabilities and a list worth reading.

De-duplication collapses catalogue rows that name the same physical component,
so one part occupies one slot (`_dedupe`).

Grouping folds fasteners and sub-components under the part they belong to
(`_group_hardware`), because "Front Bumper Cover, and its six retainers" is an
order a repairer can act on and six loose retainers is not.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.engines.types import Edge, Inspection, Part, Prediction
from app.tables.constants import (
    CAP_ORDER,
    CAP_VISIBLE,
    CHECK_MIN,
    CONSUMABLE_KLASSES,
    MAX_CHECK,
    MAX_HARDWARE_CHILDREN,
    MAX_INSPECT,
    ORDER_MIN,
    PARENT_RELATIONS,
)

# Which relation makes the better claim to be a part's parent. A fastener
# belongs to what it fastens; a sub-assembly belongs to its assembly; only
# failing both does "it is bolted to this" decide.
_RELATION_RANK = {relation: rank for rank, relation in enumerate(PARENT_RELATIONS)}

# A nesting chain is at most a handful deep in any real catalogue (seal ->
# motor -> lamp assembly). The bound only exists so a malformed catalogue
# cannot spin here.
_MAX_PARENT_HOPS = 4


@dataclass(slots=True)
class Sections:
    visible: list[Prediction] = field(default_factory=list)
    order: list[Prediction] = field(default_factory=list)
    check: list[Prediction] = field(default_factory=list)
    inspect_first: list[Inspection] = field(default_factory=list)
    hidden_count: int = 0
    # part_id of a visible/order line -> the fasteners and sub-components that
    # come with it. Additive: a client that ignores this sees the old shape.
    hardware: dict[str, list[Prediction]] = field(default_factory=dict)
    # Consumables whose parent is not in the report, collapsed into one group
    # rather than emitted as N indistinguishable lines.
    consumables: list[Prediction] = field(default_factory=list)
    # part_id -> how many catalogue rows `_dedupe` folded into that line.
    quantity: dict[str, int] = field(default_factory=dict)


def _dedupe(
    predictions: list[Prediction],
    parts: dict[str, Part],
) -> tuple[list[Prediction], dict[str, int], int]:
    """Collapse rows that name the same physical component, keeping the
    strongest probability and counting what was folded in.

    The catalogue lists a part once per fitted position, so a front corner can
    carry "Right Front Guard Grommet" under six different part ids. Before this
    ran, six duplicate rows at p=1.0 could fill every CAP_ORDER slot ahead of a
    real, distinct part sitting at p=0.98 right behind them — found by checking
    a real Yaris report rather than trusting the unit tests in isolation.
    Dedup must happen *before* the cap, which is why it lives here rather than
    only in report_service (which used to run it after the cut had already
    happened).

    The key is the name alone. Keying on (name, part_number) as this used to
    let the five "Right Front Guard Grommet" rows through untouched, because a
    manufacturer part number varies by fitted position while the component a
    repairer orders does not.

    Quantity is the largest `quantity` among the collapsed rows, not their sum.
    The rows differ by variant as often as by position — "Right Headlight Bulb
    (Single)" appears seven times for four bulb types, each row saying
    quantity 2 — so summing answers "how many catalogue rows" and prints ×14
    for a part you need two of.
    """
    best: dict[str, Prediction] = {}
    order: list[str] = []
    counts: dict[str, int] = defaultdict(int)
    dropped = 0
    for prediction in predictions:
        part = parts.get(prediction.part_id)
        if part is None:
            continue
        key = part.name
        counts[key] = max(counts[key], part.quantity)
        if key not in best:
            best[key] = prediction
            order.append(key)
        else:
            dropped += 1
            if prediction.p > best[key].p:
                best[key] = prediction
    kept = [best[key] for key in order]
    quantity = {best[key].part_id: counts[key] for key in order}
    return kept, quantity, dropped


def _drop_settled(
    predictions: list[Prediction],
    parts: dict[str, Part],
    settled: list[Prediction],
) -> tuple[list[Prediction], int]:
    """Remove components a stronger bucket has already accounted for."""
    names = {
        parts[p.part_id].name for p in settled if p.part_id in parts
    }
    kept = [
        p for p in predictions
        if p.part_id not in parts or parts[p.part_id].name not in names
    ]
    return kept, len(predictions) - len(kept)


def _nestable(part: Part, has_assembly_parent: bool) -> bool:
    """True when this part belongs under something else rather than on its own.

    Two grounds, both read off relationships the catalogue already states.
    A consumable-tier klass is a fastener — it is consumed by removing the part
    it holds and is never ordered by itself. A part the catalogue lists inside
    another part's `sub_assembly_ids` is a component of that assembly: a lens
    or a bulb holder is bought as part of the headlamp, not instead of it.
    """
    return part.klass in CONSUMABLE_KLASSES or has_assembly_parent


def _group_hardware(
    order: list[Prediction],
    visible: list[Prediction],
    parts: dict[str, Part],
    edges: list[Edge],
) -> tuple[list[Prediction], dict[str, list[Prediction]], list[Prediction]]:
    """Fold fasteners and sub-components under the part they belong to.

    Returns the substantive order lines, a parent part_id -> children map, and
    the orphan consumables that had no parent anywhere in the report.

    Parents are resolved against the *deduped* rows: a source row that lost its
    slot to an identically-named sibling still names a real parent, so sources
    are matched by name rather than by part id. Chains are followed to the
    topmost substantive ancestor, so a headlamp motor seal lands under the
    headlamp assembly rather than under the levelling motor that is itself
    nested.
    """
    # Every line the report will show, deduped, indexed by the name a source
    # edge would refer to.
    in_report = {p.part_id: p for p in visible} | {p.part_id: p for p in order}
    representative: dict[str, str] = {}
    for prediction in list(visible) + list(order):
        part = parts.get(prediction.part_id)
        if part is not None:
            representative.setdefault(part.name, prediction.part_id)

    # Incoming parent-bearing edges, collapsed onto the representative rows so
    # nine catalogue copies of one bumper cover propose one parent.
    incoming: dict[str, set[tuple[int, str]]] = defaultdict(set)
    for edge in edges:
        rank = _RELATION_RANK.get(edge.relation)
        if rank is None:
            continue
        source = parts.get(edge.src_part_id)
        target_part = parts.get(edge.dst_part_id)
        if source is None or target_part is None:
            continue
        target = representative.get(target_part.name)
        parent_id = representative.get(source.name)
        if target is None or parent_id is None or parent_id == target:
            continue
        incoming[target].add((rank, parent_id))

    assembly_parent = {
        target
        for target, sources in incoming.items()
        if any(rank == _RELATION_RANK["sub_assembly"] for rank, _ in sources)
    }

    def nestable(part_id: str) -> bool:
        part = parts.get(part_id)
        if part is None:
            return False
        return _nestable(part, part_id in assembly_parent)

    def direct_parent(part_id: str) -> str | None:
        """Best parent for one part: strongest relation, then strongest parent."""
        options = [
            (rank, -in_report[pid].p, pid)
            for rank, pid in incoming.get(part_id, ())
            if pid in in_report
        ]
        if not options:
            return None
        return min(options)[2]

    resolved: dict[str, str | None] = {}

    def top_parent(part_id: str) -> str | None:
        """Climb to the first ancestor that is not itself nested.

        Iterative and hop-bounded rather than recursive, so a catalogue that
        somehow states a cycle costs a few wasted lookups instead of a
        RecursionError on a request.
        """
        if part_id in resolved:
            return resolved[part_id]
        current = part_id
        for _ in range(_MAX_PARENT_HOPS):
            parent = direct_parent(current)
            if parent is None or parent == part_id:
                break
            if not nestable(parent):
                resolved[part_id] = parent
                return parent
            current = parent
        resolved[part_id] = None
        return None

    substantive: list[Prediction] = []
    children: dict[str, list[Prediction]] = defaultdict(list)
    orphans: list[Prediction] = []

    for prediction in order:
        if not nestable(prediction.part_id):
            substantive.append(prediction)
            continue
        parent = top_parent(prediction.part_id)
        if parent is None:
            orphans.append(prediction)
        else:
            children[parent].append(prediction)

    for group in children.values():
        group.sort(key=lambda p: p.p, reverse=True)
    orphans.sort(key=lambda p: p.p, reverse=True)

    return substantive, dict(children), orphans


def split(
    predictions: dict[str, Prediction],
    parts: dict[str, Part],
    inspections: list[Inspection] | None = None,
    edges: list[Edge] | None = None,
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
    # Buckets are settled strongest-first: a component that is already in
    # `visible` must not turn up again lower down as an inference. The
    # catalogue lists one component under several ids, so a ✓ lands on one row
    # while its namesakes stay in the order pool — which is how a bracket came
    # back as both "confirmed damaged" and "0.93 likely damaged" in the same
    # report. De-duplication is per component, not per bucket.
    visible, qty_visible, dropped_visible = _dedupe(visible, parts)
    order, dropped_above = _drop_settled(order, parts, visible)
    order, qty_order, dropped_order = _dedupe(order, parts)
    check_pool, dropped_above_check = _drop_settled(check_pool, parts, visible + order)
    check_pool, qty_check, dropped_check = _dedupe(check_pool, parts)
    hidden += dropped_visible + dropped_order + dropped_check
    hidden += dropped_above + dropped_above_check
    quantity = qty_visible | qty_order | qty_check

    # Observed parts keep the Interpreter's own ordering (insertion order of
    # the predictions dict follows the sweep, so sort by p as the stable proxy
    # the client can rely on).
    visible.sort(key=lambda p: p.p, reverse=True)
    order.sort(key=lambda p: p.p, reverse=True)

    # Fold fasteners under their parent before the cap, for the same reason
    # dedup runs before it: eight slots spent on clips is eight slots the
    # reinforcement bar behind them never gets.
    order, hardware, consumables = _group_hardware(order, visible, parts, edges or [])

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

    visible = visible[:CAP_VISIBLE]
    order = order[:CAP_ORDER]

    # Children of a line that did not survive its cap are not shown either.
    shown = {p.part_id for p in visible} | {p.part_id for p in order}
    trimmed: dict[str, list[Prediction]] = {}
    for parent_id, group in hardware.items():
        if parent_id not in shown:
            hidden += len(group)
            continue
        trimmed[parent_id] = group[:MAX_HARDWARE_CHILDREN]
        hidden += max(0, len(group) - MAX_HARDWARE_CHILDREN)

    hidden += max(0, len(consumables) - MAX_HARDWARE_CHILDREN)

    return Sections(
        visible=visible,
        order=order,
        check=check_pool[:MAX_CHECK],
        inspect_first=inspect_first,
        hidden_count=hidden,
        hardware=trimmed,
        consumables=consumables[:MAX_HARDWARE_CHILDREN],
        quantity=quantity,
    )
