"""Print the whole chain for one rego, so each hand-off can be checked by eye.

    rego -> VIN -> that vehicle's OEM catalogue -> interpreter's visible damage
         -> hidden predictions, each with the observed part it was reached from

The point is provenance. Every part id printed below comes out of this
vehicle's own `assemblies.json`; nothing is derived from the words "Toyota
Yaris". Run it with:

    backend/.venv/bin/python -m scripts.trace_chain QMN16
"""

from __future__ import annotations

import sys

from app.catalogue import registry
from app.engines import graph, orchestrator
from app.engines.history import EMPTY_HISTORY
from app.services import case_service, evidence_service, vehicle_service
from app.store import cases
from app.tables.rego_map import REGO_MAP, normalise


def trace(rego: str) -> int:
    rego = normalise(rego)
    record = REGO_MAP.get(rego)
    if record is None:
        print(f"{rego}: not a known registration")
        return 1

    slug, make, model, year, vin = record
    print("=" * 78)
    print(f"STAGE 1  rego -> VIN -> OEM catalogue")
    print("=" * 78)
    print(f"  rego                {rego}")
    print(f"  slug                {slug}")
    print(f"  VIN                 {vin}")
    print(f"  vehicle             {make} {model} {year}")

    vehicle = vehicle_service.resolve(cases.create_vehicle(rego))
    if vehicle.slug is None or vehicle.status != "catalogue_ready":
        print(f"  status              {vehicle.status} — no catalogue to predict over")
        return 1

    catalogue = registry.get(vehicle.slug)
    assert catalogue is not None
    print(f"  catalogue slug      {catalogue.slug}  (matches resolved slug: "
          f"{catalogue.slug == slug})")
    print(f"  parts indexed       {catalogue.parts_indexed:,}")
    print(f"  edges built         {len(catalogue.edges):,}")

    print()
    print("=" * 78)
    print("STAGE 2  photos -> interpreter -> visible damage")
    print("=" * 78)
    case = cases.create_case(vehicle.id)
    case_service.seed_from_interpreter(case)
    evidence = evidence_service.merge(case, catalogue)
    print(f"  impact              zone={evidence.zone} side={evidence.side} "
          f"severity={evidence.severity}")
    print(f"  observed parts      {len(evidence.observations)}")

    unresolved = [pid for pid in evidence.observations if pid not in catalogue.by_id]
    for part_id, p in sorted(
        evidence.observations.items(), key=lambda kv: -kv[1]
    ):
        part = catalogue.by_id.get(part_id)
        mark = "  " if part else "  !! NOT IN CATALOGUE !! "
        name = part.name if part else "(unresolved)"
        print(f"  {mark}p={p:.2f}  {part_id}  {name}")
    print(f"  all resolve into this catalogue: {not unresolved}")

    print()
    print("=" * 78)
    print("STAGE 3  interpreter x catalogue -> hidden damage")
    print("=" * 78)
    report = orchestrator.run(
        catalogue.parts, catalogue.edges, evidence, EMPTY_HISTORY,
        conflicts=case.conflicts,
    )

    # The edges actually in play, so each prediction's parent can be checked.
    candidates = {p.part_id for p in graph.candidate_set(catalogue.parts, evidence)}
    parents: dict[str, set[str]] = {}
    for edge in catalogue.edges:
        if edge.src_part_id in candidates and edge.dst_part_id in candidates:
            parents.setdefault(edge.dst_part_id, set()).add(edge.src_part_id)

    print(f"  candidates scored   {report.candidates}")
    print(f"  computed in         {report.computed_ms} ms")
    print()
    print("  HIDDEN — predicted, in no photo:")
    for prediction in report.sections.order:
        part = catalogue.by_id[prediction.part_id]
        in_catalogue = prediction.part_id in catalogue.by_id
        print(f"    p={prediction.p:.3f}  {part.name}")
        print(f"              part_id   {prediction.part_id}  (in catalogue: {in_catalogue})")
        print(f"              reason    {prediction.reason}")
        for cause in prediction.attribution[:3]:
            if cause.relation in ("leak", "root"):
                print(f"              via       {cause.cause} ({cause.relation}, "
                      f"{cause.share:.0%})")
                continue
            # Name the observed part this was reached from, and prove the edge.
            connected = any(
                catalogue.by_id[src].name == cause.cause
                for src in parents.get(prediction.part_id, ())
            )
            observed = any(
                catalogue.by_id[src].name == cause.cause and src in evidence.observations
                for src in parents.get(prediction.part_id, ())
            )
            print(f"              via       {cause.cause} ({cause.relation}, "
                  f"{cause.share:.0%})  edge-connected={connected} observed={observed}")
        hardware = report.sections.hardware.get(prediction.part_id, [])
        if hardware:
            print(f"              + {len(hardware)} fasteners: "
                  f"{', '.join(catalogue.by_id[h.part_id].name for h in hardware[:3])}...")

    print()
    print("  DEPENDENCE CHECK — same vehicle, interpreter output removed:")
    blank_case = cases.create_case(vehicle.id)  # never seeded
    blank = evidence_service.merge(blank_case, catalogue)
    without = orchestrator.run(catalogue.parts, catalogue.edges, blank, EMPTY_HISTORY)
    print(f"    hidden parts with evidence:    {len(report.sections.order)}")
    print(f"    hidden parts without evidence: {len(without.sections.order)}")
    for prediction in report.sections.order[:5]:
        fallback = without.predictions.get(prediction.part_id)
        print(f"      {catalogue.by_id[prediction.part_id].name[:44]:44s} "
              f"{prediction.p:.3f} -> {fallback.p if fallback else 0.0:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(trace(sys.argv[1] if len(sys.argv) > 1 else "QMN16"))
