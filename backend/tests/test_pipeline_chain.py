"""The chain that has to be real: rego -> VIN -> this vehicle's OEM catalogue,
joined to Partly's interpreter output, propagated over that catalogue's own
connectivity.

The claim being defended is provenance. "Toyota Yaris" is not enough to know a
vehicle's parts — the VIN's catalogue is — so nothing downstream may invent a
part from a make and model, and every id in the report has to come out of the
`assemblies.json` that the resolved slug loaded.

`test_the_prediction_collapses_without_the_interpreter` is the one that matters
most. It failed before the direct term was conditioned on observed support: an
un-seeded Yaris case, with no interpreter output at all, produced six of the
same eight order lines at the same probabilities. A hidden-damage prediction
that survives deleting the evidence is not a prediction.
"""

from __future__ import annotations

import pytest

from app.catalogue import registry
from app.engines import graph, orchestrator
from app.engines.history import EMPTY_HISTORY
from app.services import case_service, evidence_service, vehicle_service
from app.store import cases
from app.tables.rego_map import REGO_MAP

YARIS_REGO = "QMN16"
YARIS_SLUG = "toyota-yaris-qmn16"
YARIS_VIN = "JTDKBAA3301006094"


@pytest.fixture
def chain():
    """Walk the real chain once and hand back every stage's output."""
    cases.reset()
    vehicle = vehicle_service.resolve(cases.create_vehicle(YARIS_REGO))
    catalogue = registry.get(vehicle.slug)
    case = cases.create_case(vehicle.id)
    case_service.seed_from_interpreter(case)
    evidence = evidence_service.merge(case, catalogue)
    report = orchestrator.run(
        catalogue.parts, catalogue.edges, evidence, EMPTY_HISTORY,
        conflicts=case.conflicts,
    )
    yield vehicle, catalogue, evidence, report
    cases.reset()


# --- stage 1: the catalogue is the one the VIN resolved to ------------------

def test_the_rego_resolves_to_its_own_vin_and_catalogue(chain):
    vehicle, catalogue, _, _ = chain
    assert vehicle.vin == YARIS_VIN
    assert vehicle.slug == YARIS_SLUG
    assert catalogue.slug == YARIS_SLUG, "the loaded catalogue is not this VIN's"
    assert REGO_MAP[YARIS_REGO][0] == catalogue.slug
    assert catalogue.parts_indexed > 7000
    assert len(catalogue.edges) > 10_000


def test_the_parts_come_from_the_vehicles_own_file_not_its_name():
    """Each vehicle's parts are whatever its `assemblies.json` contains.

    Note that Partly's part ids are *global* catalogue ids, not per-vehicle
    ones: a generic "Left Cover" carries the same id on both cars, and the
    Yaris and the Santa Fe share about 30% of their ids for exactly that
    reason. So the check is not that the id sets are disjoint — it is that each
    vehicle's set is its own, drawn from its own file, and that the fleet is
    not being served one list keyed off a model name.
    """
    yaris = vehicle_service.resolve(cases.create_vehicle(YARIS_REGO))
    santafe = vehicle_service.resolve(cases.create_vehicle("PNS53"))
    yaris_ids = {p.part_id for p in registry.get(yaris.slug).parts}
    santafe_ids = {p.part_id for p in registry.get(santafe.slug).parts}

    assert yaris_ids and santafe_ids
    assert yaris_ids != santafe_ids
    # Most of each catalogue is specific to that vehicle.
    assert len(yaris_ids - santafe_ids) / len(yaris_ids) > 0.5
    assert len(santafe_ids - yaris_ids) / len(santafe_ids) > 0.5
    cases.reset()


# --- stage 2: the interpreter's parts land in this catalogue ----------------

def test_every_observed_part_resolves_into_this_vehicles_catalogue(chain):
    """A damaged part id that does not resolve is a broken join, and must be
    visible rather than silently dropped."""
    _, catalogue, evidence, _ = chain
    assert evidence.observations, "the interpreter produced no damaged parts"
    unresolved = [pid for pid in evidence.observations if pid not in catalogue.by_id]
    assert not unresolved, f"observed part ids not in this catalogue: {unresolved}"


def test_the_impact_descriptor_comes_from_the_interpreter(chain):
    _, _, evidence, _ = chain
    assert evidence.zone == "front"
    assert evidence.severity >= 3


# --- stage 3: the predictions belong to this vehicle, and to this evidence ---

def test_every_predicted_part_belongs_to_this_catalogue(chain):
    _, catalogue, _, report = chain
    everything = (
        report.sections.visible
        + report.sections.order
        + report.sections.check
        + report.sections.consumables
        + [child for group in report.sections.hardware.values() for child in group]
    )
    assert everything
    for prediction in everything:
        assert prediction.part_id in catalogue.by_id, (
            f"{prediction.part_id} is not a part of {catalogue.slug}"
        )


def test_each_hidden_part_was_reached_from_something_observed(chain):
    """Not merely edge-connected to *something* — connected, by a chain the
    sweep actually walked, to a part the interpreter reported damaged."""
    _, catalogue, evidence, report = chain
    candidates = {p.part_id for p in graph.candidate_set(catalogue.parts, evidence)}

    incoming: dict[str, set[str]] = {}
    for edge in catalogue.edges:
        if edge.src_part_id in candidates and edge.dst_part_id in candidates:
            incoming.setdefault(edge.dst_part_id, set()).add(edge.src_part_id)

    def reaches_observed(part_id: str, hops: int = 3) -> bool:
        seen, frontier = {part_id}, {part_id}
        for _ in range(hops):
            nxt: set[str] = set()
            for node in frontier:
                for parent in incoming.get(node, ()):
                    if parent in evidence.observations:
                        return True
                    if parent not in seen:
                        seen.add(parent)
                        nxt.add(parent)
            frontier = nxt
        return False

    assert report.sections.order, "no hidden parts to check"
    for prediction in report.sections.order:
        assert reaches_observed(prediction.part_id), (
            f'"{catalogue.by_id[prediction.part_id].name}" is not connected to any '
            "part the interpreter saw — the graph did not reach it from the damage"
        )


def test_the_prediction_collapses_without_the_interpreter(chain):
    """The dependence test. Same vehicle, same catalogue, same graph — only the
    interpreter's output removed. If the hidden list survives that, it was
    never caused by the damage."""
    vehicle, catalogue, _, report = chain
    assert report.sections.order, "the seeded case must predict something"

    unseeded = cases.create_case(vehicle.id)  # never seeded from the interpreter
    blank = evidence_service.merge(unseeded, catalogue)
    assert not blank.observations

    without = orchestrator.run(catalogue.parts, catalogue.edges, blank, EMPTY_HISTORY)

    assert not without.sections.order, (
        "parts are still being ordered with no evidence of damage at all: "
        f"{[catalogue.by_id[p.part_id].name for p in without.sections.order]}"
    )
    for prediction in report.sections.order:
        fallback = without.predictions.get(prediction.part_id)
        base = fallback.p if fallback else 0.0
        assert base < prediction.p / 2, (
            f'"{catalogue.by_id[prediction.part_id].name}" barely moves when the '
            f"evidence is removed ({prediction.p:.3f} -> {base:.3f})"
        )


def test_a_different_impact_predicts_different_parts(chain):
    """The other direction: change what was seen and the answer must change."""
    _, catalogue, evidence, report = chain
    from dataclasses import replace

    rear = replace(evidence, zone="rear")
    other = orchestrator.run(catalogue.parts, catalogue.edges, rear, EMPTY_HISTORY)
    front_names = {catalogue.by_id[p.part_id].name for p in report.sections.order}
    rear_names = {catalogue.by_id[p.part_id].name for p in other.sections.order}
    assert front_names != rear_names
