"""assemblies.json -> tagged Part objects.

The shipped shape is:

    {"completed": {"oem_vehicle_id": ..., "root_nodes": [...],
                   "assemblies": {part_id: {...}}, "diagrams": {diagram_id: {...}}}}

Fields are sparse and that is expected: of the Yaris's 7,009 assemblies only
3,563 carry a hotspot and 3,029 a manufacturer part number. Anything optional is
carried through as None rather than defaulted, so the API can be honest about
what it does not have.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.catalogue.tagger import tag
from app.engines.types import Part


def load_raw(path: Path) -> dict:
    with path.open("rb") as handle:
        payload = json.load(handle)
    return payload.get("completed", payload)


def build_parts(raw: dict) -> list[Part]:
    assemblies: dict = raw.get("assemblies", {})
    parts: list[Part] = []

    for part_id, record in assemblies.items():
        name = record.get("display_name") or record.get("description") or ""
        if not name:
            continue
        std_note = record.get("std_note")
        tags = tag(name, std_note)

        hotspot_record = record.get("hotspot") or {}
        hotspot = None
        diagram_id = hotspot_record.get("diagram_id")
        if all(k in hotspot_record for k in ("x1", "y1", "x2", "y2")):
            hotspot = (
                int(hotspot_record["x1"]),
                int(hotspot_record["y1"]),
                int(hotspot_record["x2"]),
                int(hotspot_record["y2"]),
            )

        parts.append(
            Part(
                part_id=part_id,
                name=name,
                klass=tags["klass"],
                depth=tags["depth"],
                zone=tags["zone"],
                side=tags["side"],
                part_number=record.get("manufacturer_part_number"),
                std_note=std_note,
                leak_class=tags["leak_class"],
                is_orderable=bool(record.get("is_orderable", True)),
                quantity=int(record.get("quantity") or 1),
                diagram_id=diagram_id,
                hotspot=hotspot,
            )
        )

    return parts


def build_diagrams(raw: dict) -> dict[str, dict]:
    """diagram_id -> {name, code, category, assembly_ids}."""
    out: dict[str, dict] = {}
    for diagram_id, record in (raw.get("diagrams") or {}).items():
        out[diagram_id] = {
            "id": diagram_id,
            "name": record.get("name"),
            "code": record.get("code"),
            "category": record.get("category"),
            "assembly_ids": record.get("assembly_ids") or [],
        }
    return out


def sub_assembly_links(raw: dict) -> list[tuple[str, str]]:
    """(parent_part_id, child_part_id) from `sub_assembly_ids`."""
    links: list[tuple[str, str]] = []
    for part_id, record in (raw.get("assemblies") or {}).items():
        for child in record.get("sub_assembly_ids") or []:
            child_id = child.get("id") if isinstance(child, dict) else child
            if child_id:
                links.append((part_id, child_id))
    return links
