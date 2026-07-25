"""Relation extraction: tagged parts -> component_edge rows.

Two sources, in decreasing order of trustworthiness:

  sub_assembly  the catalogue itself says B is a sub-assembly of A
  name_parse    a rule in tables.edge_prior says this klass pair is related,
                and the two parts agree on zone and side

The second is where the useful structure comes from. "Front Bumper Cover" and
"Front Bumper Cover Retainer - Right Upper" are on the same diagram but nothing
in the data links them; the (bumper_cover, cover_retainer, hardware) rule does.

Fan-out is capped per source part. A front end can contain a hundred clips, and
wiring one bumper cover to all of them adds no information while costing a
hundred edge traversals in every sweep.
"""

from __future__ import annotations

from collections import defaultdict

from app.engines.types import Edge, Part
from app.tables.edge_prior import EDGE_PRIOR
from app.tables.klass_rules import CENTRELINE_KLASSES

# Most a single part may point at for one rule.
MAX_FANOUT_PER_RULE = 12
# Most sources of a single klass that may fire one rule (avoids clip x clip storms).
MAX_SOURCES_PER_RULE = 24

# Relations tight enough that the two parts must belong to the same assembly.
# `clip` and `cover_retainer` are generic buckets with hundreds of members each,
# so a zone match alone wires a bumper cover to every clip in the front of the
# car, including the door seal clips.
SAME_ASSEMBLY_RELATIONS = frozenset({"hardware"})

# Words that describe position or packaging rather than which assembly a part
# belongs to. Stripped before comparing names.
_STOPWORDS = frozenset(
    {
        "right", "left", "upper", "lower", "inner", "outer", "number",
        "assembly", "sub", "sub-assembly", "kit", "set", "and", "for",
        "with", "no", "rh", "lh", "single", "type",
    }
)


def assembly_tokens(name: str) -> frozenset[str]:
    """The words in a part name that say which assembly it belongs to."""
    cleaned = name.lower().replace("-", " ").replace("(", " ").replace(")", " ")
    return frozenset(
        word for word in cleaned.split() if word not in _STOPWORDS and len(word) > 1
    )


def _same_assembly(src: Part, dst: Part, src_tokens: frozenset[str]) -> bool:
    """Does the target plausibly belong to the source's assembly?

    Diagram co-membership would be the natural test, but this catalogue splits
    "Front Bumper Cover" and "Front Bumper Cover Retainer - Right Upper" across
    two diagrams, so it rejects exactly the edge that matters most. Name-stem
    overlap keeps that pair and still rejects "Right Front Door Seal Clip",
    which shares only the word "front".
    """
    if src.diagram_id is not None and src.diagram_id == dst.diagram_id:
        return True
    if not src_tokens:
        return False
    # Short source names ("Right Headlamp Assembly" -> {headlamp}) only have one
    # token to offer, so the bar is whatever the source can actually supply.
    required = min(2, len(src_tokens))
    return len(src_tokens & assembly_tokens(dst.name)) >= required


def _sides_compatible(src: Part, dst: Part) -> bool:
    if src.side == dst.side:
        return True
    if src.side == "C" or dst.side == "C":
        return True
    if src.klass in CENTRELINE_KLASSES or dst.klass in CENTRELINE_KLASSES:
        return True
    return False


def build_edges(parts: list[Part], sub_links: list[tuple[str, str]] | None = None) -> list[Edge]:
    by_klass_zone: dict[tuple[str, str], list[Part]] = defaultdict(list)
    for part in parts:
        by_klass_zone[(part.klass, part.zone)].append(part)

    known = {part.part_id for part in parts}
    seen: set[tuple[str, str, str]] = set()
    edges: list[Edge] = []

    # --- rule-driven edges --------------------------------------------------
    for (klass_from, klass_to, relation) in EDGE_PRIOR:
        for zone in ("front", "rear", "left", "right", "other"):
            sources = by_klass_zone.get((klass_from, zone), [])
            targets = by_klass_zone.get((klass_to, zone), [])
            if not sources or not targets:
                continue
            tight = relation in SAME_ASSEMBLY_RELATIONS
            for src in sources[:MAX_SOURCES_PER_RULE]:
                fanout = 0
                src_tokens = assembly_tokens(src.name) if tight else frozenset()
                for dst in targets:
                    if src.part_id == dst.part_id:
                        continue
                    if not _sides_compatible(src, dst):
                        continue
                    if tight and not _same_assembly(src, dst, src_tokens):
                        continue
                    key = (src.part_id, dst.part_id, relation)
                    if key in seen:
                        continue
                    seen.add(key)
                    edges.append(
                        Edge(
                            src_part_id=src.part_id,
                            dst_part_id=dst.part_id,
                            relation=relation,
                            derived_from="name_parse",
                        )
                    )
                    fanout += 1
                    if fanout >= MAX_FANOUT_PER_RULE:
                        break

    # --- catalogue-declared sub-assemblies ---------------------------------
    for parent_id, child_id in sub_links or []:
        if parent_id not in known or child_id not in known:
            continue
        key = (parent_id, child_id, "sub_assembly")
        if key in seen:
            continue
        seen.add(key)
        edges.append(
            Edge(
                src_part_id=parent_id,
                dst_part_id=child_id,
                relation="sub_assembly",
                derived_from="catalogue",
            )
        )

    return edges
