"""The order bucket a repairer actually reads.

Every test here failed before the noisy-OR learned that nine catalogue rows of
one bumper cover are one cause. The Yaris order bucket used to be:

    1.00  Right Front Guard Grommet          1.00  Radiator Support Headlamp Bracket - Left
    1.00  Right Front Guard Grommet          1.00  Radiator Support Headlamp Bracket - Left
    1.00  Right Front Guard Grommet          1.00  Radiator Support Headlamp Bracket - Right
    1.00  Right Front Guard Clip             1.00  Right Front Guard Grommet

— eight slots, one probability, three distinct components, no reinforcement
bar. The unit tests below pin the mechanism; the ones driven by the real
catalogue pin the result, because the mechanism passed its unit tests the whole
time the report was unreadable.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.engines import buckets, graph
from app.engines.types import Edge, Evidence, Part
from app.main import create_app
from app.services import vehicle_service
from app.store import cases
from app.tables.constants import CONSUMABLE_KLASSES, ORDER_MIN

YARIS_REGO = "QMN16"


def part(pid, klass, depth, name=None, side="R", zone="front"):
    return Part(part_id=pid, name=name or pid, klass=klass, depth=depth,
                zone=zone, side=side)


# --- the mechanism ----------------------------------------------------------

def test_one_cause_listed_many_times_does_not_become_certainty():
    """The bug, in miniature. Nine `bumper_cover` rows — the cover, its halves,
    extensions, inserts and assembly — each fire a hardware edge at λ=0.90 into
    the same retainer. Multiplied as nine independent causes they leave a
    survival of 0.145**9, which is 1.0 to four decimal places."""
    covers = [part(f"cover{i}", "bumper_cover", 0, name=f"Front Bumper Cover {i}")
              for i in range(9)]
    retainer = part("retainer", "cover_retainer", 1, name="Cover Retainer")
    edges = [Edge(cover.part_id, "retainer", "hardware") for cover in covers]
    observed = {cover.part_id: 0.95 for cover in covers}

    p = graph.propagate([*covers, retainer], edges,
                        Evidence("front", "R", 4, observed))["retainer"].p

    assert p < 0.999, f"nine copies of one cause still saturate: {p:.6f}"
    # It must still be high — a retainer on a wrecked bumper cover is going in
    # the bin. What it must not be is indistinguishable from every other part.
    assert p > 0.9


def test_a_single_parent_is_unchanged_by_the_grouping():
    """The spec 9.3 numbers are not up for renegotiation: with one incoming
    edge there is nothing to group, and the survival product is untouched."""
    cover = part("cover", "bumper_cover", 0, name="Front Bumper Cover")
    retainer = part("retainer", "cover_retainer", 1, name="Cover Retainer")
    evidence = Evidence("front", "R", 3, {"cover": 0.98})

    p = graph.propagate([cover, retainer], [Edge("cover", "retainer", "hardware")],
                        evidence)["retainer"].p
    assert p == pytest.approx(0.978, abs=0.002)


def test_independent_causes_still_compound():
    """Only the re-listing of one cause is damped. A fender and a bumper cover
    are genuinely separate reasons for a clip to be scrap, and two of them must
    still beat one."""
    clip = part("clip", "clip", 2, name="Clip")
    cover = part("cover", "bumper_cover", 0, name="Front Bumper Cover")
    fender = part("fender", "fender", 1, name="Right Front Guard Panel")
    parts = [cover, fender, clip]

    one = graph.propagate(parts, [Edge("cover", "clip", "hardware")],
                          Evidence("front", "R", 4, {"cover": 0.95}))["clip"].p
    two = graph.propagate(
        parts,
        [Edge("cover", "clip", "hardware"), Edge("fender", "clip", "hardware")],
        Evidence("front", "R", 4, {"cover": 0.95, "fender": 0.95}),
    )["clip"].p
    assert two > one


def test_dedupe_collapses_on_name_across_part_numbers():
    """The five "Right Front Guard Grommet" rows carry five different
    manufacturer part numbers, which is exactly why keying on
    (name, part_number) let every one of them through."""
    parts, predictions = {}, {}
    for i in range(5):
        pid = f"grommet{i}"
        parts[pid] = Part(part_id=pid, name="Right Front Guard Grommet", klass="clip",
                          depth=2, zone="front", side="R", part_number=f"PN-{i}")
        predictions[pid] = graph.Prediction(part_id=pid, p=1.0, reason="")
    panel = Part(part_id="panel", name="Right Front Guard Panel", klass="fender",
                 depth=1, zone="front", side="R", part_number="PN-panel")
    parts["panel"] = panel
    predictions["panel"] = graph.Prediction(part_id="panel", p=0.9, reason="")

    sections = buckets.split(predictions, parts)
    # Counted across everything the report shows: five rows in, one component
    # out, wherever grouping decides to put it.
    names = [parts[p.part_id].name for p in sections.order + sections.consumables]
    assert names.count("Right Front Guard Grommet") == 1
    assert "Right Front Guard Panel" in names


def test_a_fastener_nests_under_the_part_it_fastens():
    panel = Part(part_id="panel", name="Right Front Guard Panel", klass="fender",
                 depth=1, zone="front", side="R")
    clip = Part(part_id="clip", name="Right Front Guard Clip", klass="clip",
                depth=2, zone="front", side="R")
    parts = {"panel": panel, "clip": clip}
    predictions = {
        "panel": graph.Prediction(part_id="panel", p=0.86, reason=""),
        "clip": graph.Prediction(part_id="clip", p=0.97, reason=""),
    }

    sections = buckets.split(predictions, parts, edges=[Edge("panel", "clip", "hardware")])

    assert [p.part_id for p in sections.order] == ["panel"]
    assert [p.part_id for p in sections.hardware["panel"]] == ["clip"]
    assert sections.consumables == []


def test_a_parentless_fastener_goes_to_the_consumables_group():
    clip = Part(part_id="clip", name="Some Clip", klass="clip", depth=2,
                zone="front", side="R")
    predictions = {"clip": graph.Prediction(part_id="clip", p=0.97, reason="")}

    sections = buckets.split(predictions, {"clip": clip}, edges=[])

    assert sections.order == []
    assert [p.part_id for p in sections.consumables] == ["clip"]


# --- the result, on the real Yaris ------------------------------------------

@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


def open_case(client, rego=YARIS_REGO):
    """Register, resolve without waiting on the simulated VIN latency, open a
    case, and return its first report."""
    registered = client.post("/v1/vehicle/register", json={"rego": rego})
    vehicle_id = registered.json()["vehicle_id"]
    vehicle_service.resolve(cases.get_vehicle(vehicle_id))
    case_id = client.post("/v1/case", json={"vehicle_id": vehicle_id}).json()["case_id"]
    return client.get(f"/v1/prediction/results/{case_id}").json()


@pytest.fixture
def yaris(client):
    """The shipped Yaris prediction, run end to end through the real catalogue."""
    cases.reset()
    yield open_case(client)
    cases.reset()


def klass_of(name: str) -> str:
    from app.catalogue.tagger import classify

    return classify(name)


def test_the_order_bucket_is_not_a_wall_of_ones(yaris):
    """Acceptance 1. 55 parts used to sit at p >= 0.999, eight of them holding
    every order slot, so the ranking carried no information at all.

    The bar is that nothing in `order` is pinned at certainty. Every line here
    is inferred — an observed part goes to `visible` — so a line at 0.99999 is
    the model claiming to be sure about something nobody has looked at. Before
    the fix the Yaris top three sat at exactly that.
    """
    order = yaris["sections"]["order"]
    assert order, "the Yaris must produce an order bucket"

    probabilities = [line["p"] for line in order]
    assert not [p for p in probabilities if p >= 0.999], (
        f"order lines pinned at certainty: "
        f"{[line['name'] for line in order if line['p'] >= 0.999]}"
    )
    assert max(probabilities) < 0.99, (
        f"top order line at {max(probabilities):.5f} — an inference, not an observation"
    )
    assert len(set(probabilities)) > 1, "every order line has the same probability"


def test_no_component_appears_twice_in_the_order_bucket(yaris):
    """Acceptance 2."""
    names = [line["name"] for line in yaris["sections"]["order"]]
    assert len(names) == len(set(names)), f"duplicate order lines: {names}"


def test_no_component_appears_in_two_buckets_at_once(yaris):
    """One component, one statement. It is listed under several catalogue ids,
    so without this a ✓ on one id left its namesakes sitting in `order` — the
    report saying "confirmed damaged" and "0.93 likely damaged" about the same
    bracket, one line apart."""
    seen: dict[str, str] = {}
    for section in ("visible", "order", "check"):
        for line in yaris["sections"][section]:
            assert line["name"] not in seen, (
                f'"{line["name"]}" is in both {seen.get(line["name"])} and {section}'
            )
            seen[line["name"]] = section


def test_the_order_bucket_is_ranked_by_probability(yaris):
    probabilities = [line["p"] for line in yaris["sections"]["order"]]
    assert probabilities == sorted(probabilities, reverse=True)


def test_no_bare_fasteners_at_the_top_level(yaris):
    """Acceptance 3. A clip is never something a repairer orders on its own; it
    comes with the panel it holds."""
    loose = [
        line["name"]
        for line in yaris["sections"]["order"]
        if klass_of(line["name"]) in CONSUMABLE_KLASSES
    ]
    assert not loose, f"consumables emitted as standalone order lines: {loose}"


def test_fasteners_are_still_in_the_report_just_nested(yaris):
    """Grouping must not mean quietly dropping them — they still get ordered."""
    nested = [
        child
        for section in ("visible", "order")
        for line in yaris["sections"][section]
        for child in line["hardware"]
    ]
    assert nested, "no hardware was attached to any line"
    assert any(klass_of(child["name"]) in CONSUMABLE_KLASSES for child in nested)
    for child in nested:
        assert {"part_id", "name", "p"} <= set(child)


def test_the_parts_a_repairer_needs_are_in_the_report(yaris):
    """Acceptance 4. The structural front end used to sit below the fasteners;
    the bar, the absorber and the lamp brackets have to be on the page."""
    shown = {
        line["name"]: line["p"]
        for section in ("visible", "order")
        for line in yaris["sections"][section]
    }
    klasses = {klass_of(name) for name in shown}

    for wanted in ("reinforcement_beam", "bumper_absorber", "lamp_bracket"):
        assert wanted in klasses, f"no {wanted} anywhere in the report: {sorted(shown)}"

    # And the order bucket itself is substantive, not padding.
    order_klasses = {klass_of(line["name"]) for line in yaris["sections"]["order"]}
    assert order_klasses - CONSUMABLE_KLASSES, "the order bucket is all consumables"


def test_every_order_line_clears_the_threshold(yaris):
    for line in yaris["sections"]["order"]:
        assert line["p"] >= ORDER_MIN


@pytest.mark.parametrize("rego", ["QMN16", "PNS53", "RFH447"])
def test_every_catalogued_vehicle_produces_a_clean_bucket(client, rego):
    """The same invariants on all three vehicles, not just the one that was
    debugged. The E-Pace matters most: its strongest observation is p=0.45, and
    the old engine still turned that into eight order lines reaching 0.80 by
    counting one bumper cover a dozen times. It now orders nothing, which is
    the honest reading of evidence that weak."""
    cases.reset()
    report = open_case(client, rego)

    order = report["sections"]["order"]
    names = [line["name"] for line in order]
    assert len(names) == len(set(names)), f"{rego} repeats a component: {names}"

    for line in order:
        assert line["p"] < 0.999, f"{rego}: {line['name']} pinned at {line['p']}"
        assert klass_of(line["name"]) not in CONSUMABLE_KLASSES, (
            f"{rego}: bare fastener {line['name']} at top level"
        )
    cases.reset()


def test_a_tick_and_a_cross_pull_a_dependent_apart():
    """Acceptance 2, as a fixed chain so the margin is exact rather than
    whatever the catalogue happens to give. Saturation used to make this
    untestable: a part already at 1.0 cannot be moved by anything."""
    cover = part("cover", "bumper_cover", 0, side="C", name="Front Bumper Cover")
    absorber = part("absorber", "bumper_absorber", 2, side="C", name="Impact Absorber")
    beam = part("beam", "reinforcement_beam", 3, side="C", name="Reinforcement Beam")
    parts = [cover, absorber, beam]
    edges = [Edge("cover", "absorber", "load_path"), Edge("absorber", "beam", "load_path")]
    evidence = Evidence("front", "C", 4, {"cover": 0.95})

    damaged = graph.propagate(parts, edges, _confirming(evidence, "absorber", True))
    clean = graph.propagate(parts, edges, _confirming(evidence, "absorber", False))

    spread = damaged["beam"].p - clean["beam"].p
    assert spread > 0.2, f"a tick and a cross move the beam by only {spread:.4f}"


def _confirming(evidence: Evidence, part_id: str, damaged: bool) -> Evidence:
    from dataclasses import replace

    return replace(evidence, confirmations={**evidence.confirmations, part_id: damaged})


def test_confirming_a_real_part_rearranges_the_real_list(client):
    """Acceptance 2 on the shipped Yaris. The demo's money moment is a tick
    that visibly reorders the report, so assert the three things that make it
    visible rather than trusting it."""
    cases.reset()
    report = open_case(client)
    case_id = report["case_id"]
    before = report["sections"]["order"]
    # A part with dependents — ticking a leaf bracket is honestly inert, since
    # nothing hangs off it to move.
    target = next(line for line in before if line["hardware"])

    after = client.post(
        "/v1/inspection/confirm",
        json={"case_id": case_id, "part_id": target["part_id"], "damaged": True},
    ).json()

    # 1. It is promoted, at the top, settled.
    assert after["sections"]["visible"][0]["part_id"] == target["part_id"]
    assert after["sections"]["visible"][0]["p"] == 1.0
    # 2. It has left the bucket it was in.
    assert target["part_id"] not in {line["part_id"] for line in after["sections"]["order"]}
    # 3. The bucket refills — the slot goes to a part that was not shown before,
    #    which is the movement a repairer actually sees.
    was = {line["part_id"] for line in before}
    arrived = [line for line in after["sections"]["order"] if line["part_id"] not in was]
    assert arrived, "nothing moved up to take the freed slot"
    cases.reset()


def test_denying_a_part_lowers_what_hangs_off_it():
    """Acceptance 7, at the level the grouping could have broken: a cross is
    not just a row disappearing, it withdraws the evidence its dependents were
    resting on."""
    cover = part("cover", "bumper_cover", 0, name="Front Bumper Cover")
    retainer = part("retainer", "cover_retainer", 1, name="Cover Retainer")
    parts, edges = [cover, retainer], [Edge("cover", "retainer", "hardware")]

    before = graph.propagate(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    after = graph.propagate(
        parts, edges,
        Evidence("front", "R", 3, {"cover": 0.98}, confirmations={"cover": False}),
    )
    assert after["retainer"].p < before["retainer"].p
    assert after["cover"].p == 0.0


def test_confirming_an_order_line_promotes_it_and_keeps_its_hardware(client, yaris):
    """A tick moves the part to `visible`; the fasteners grouped under it have
    to travel with it rather than being orphaned into the consumables pile."""
    case_id = yaris["case_id"]
    target = next(
        (line for line in yaris["sections"]["order"] if line["hardware"]), None
    )
    if target is None:
        pytest.skip("no grouped order line to confirm")

    body = client.post(
        "/v1/inspection/confirm",
        json={"case_id": case_id, "part_id": target["part_id"], "damaged": True},
    ).json()

    promoted = next(
        (line for line in body["sections"]["visible"] if line["part_id"] == target["part_id"]),
        None,
    )
    assert promoted is not None, "a confirmed part must appear in visible"
    assert promoted["p"] == 1.0
    assert promoted["hardware"], "its hardware must come with it"

    # And it leaves the bucket it was promoted out of, under every id the
    # catalogue gives it.
    assert target["name"] not in {line["name"] for line in body["sections"]["order"]}


def test_quantity_counts_parts_not_catalogue_rows(yaris):
    """"Right Headlight Bulb (Single)" is listed seven times for four bulb
    types, each row saying quantity 2. Summing them printed x14 for a part you
    need two of."""
    for section in ("visible", "order"):
        for line in yaris["sections"][section]:
            assert 1 <= line["qty"] <= 24, f"{line['name']} qty {line['qty']}"
            for child in line["hardware"]:
                assert 1 <= child["qty"] <= 24, f"{child['name']} qty {child['qty']}"

# --- plausibility: does the list make sense to a repairer? -------------------

def _catalogue_and_edges(rego=YARIS_REGO):
    """The real catalogue, its evidence, and the narrowed edge list in play."""
    from app.catalogue import registry
    from app.engines import graph as graph_engine
    from app.services import case_service, evidence_service, vehicle_service

    vehicle = vehicle_service.resolve(cases.create_vehicle(rego))
    catalogue = registry.get(vehicle.slug)
    case = cases.create_case(vehicle.id)
    case_service.seed_from_interpreter(case)
    evidence = evidence_service.merge(case, catalogue)
    candidates = {p.part_id for p in graph_engine.candidate_set(catalogue.parts, evidence)}
    connected: dict[str, set[str]] = {}
    for edge in catalogue.edges:
        if edge.src_part_id in candidates and edge.dst_part_id in candidates:
            connected.setdefault(edge.dst_part_id, set()).add(
                catalogue.by_id[edge.src_part_id].name
            )
    return catalogue, evidence, connected


def test_nothing_from_the_wrong_end_of_the_car(yaris):
    """A front-corner impact must not order rear or interior parts. It used to:
    "Left Rear Fog Lamp Assembly" was tagged front, because the zone rule
    claimed every "fog lamp" before it checked for "rear"."""
    catalogue, evidence, _ = _catalogue_and_edges()
    off_zone = [
        line["name"]
        for line in yaris["sections"]["order"]
        if catalogue.by_id[line["part_id"]].zone != evidence.zone
    ]
    assert not off_zone, f"parts from outside the impact zone: {off_zone}"
    cases.reset()


def test_every_named_cause_is_a_part_it_is_actually_connected_to(yaris):
    """An explanation naming a part the graph never linked is worse than no
    explanation — it reads as authoritative and is fiction."""
    _, _, connected = _catalogue_and_edges()
    for line in yaris["sections"]["order"]:
        parents = connected.get(line["part_id"], set())
        for cause in line["attribution"]:
            if cause["relation"] in ("leak", "root", "observation", "confirmed"):
                continue
            assert cause["cause"] in parents, (
                f'"{line["name"]}" is explained by "{cause["cause"]}" '
                f'({cause["relation"]}), which it has no edge from'
            )
    cases.reset()


def test_the_reason_names_the_cause_that_actually_drove_it(yaris):
    """Every headlamp bracket used to read "behind the lamp you've already
    lost" — a klass template, identical whether the bracket was there because
    of the right lamp, the left one, or the impact itself."""
    from app.tables.reasons import RELATION_REASON

    named = 0
    for line in yaris["sections"]["order"]:
        attribution = line["attribution"]
        assert attribution, f'{line["name"]} has no attribution'
        direct = sum(
            c["share"] for c in attribution if c["relation"] in ("leak", "root")
        )
        parent = next(
            (c for c in attribution if c["relation"] in RELATION_REASON), None
        )
        if parent is not None and (1.0 - direct) >= direct:
            assert parent["cause"] in line["reason"], (
                f'{line["name"]}: reason "{line["reason"]}" does not name '
                f'{parent["cause"]}, which drove {parent["share"]:.0%} of it'
            )
            named += 1

    assert named, "no order line was explained by a parent — the graph is inert"
    cases.reset()


# --- clarifying questions ---------------------------------------------------
#
# The old questions asked about the crash — "are the wheels sitting straight?",
# "did the airbags go off?", "does the door still shut?" — which the repairer
# never saw, and which were the same three every time. What replaces them is
# one part out of this case's own predictions, that he can walk over and look
# at right now.

CRASH_QUESTIONS = {"q_wheels", "q_airbags", "q_door"}


def _answer_every_question(client, case_id, limit=5):
    """Walk the case forward, taking the first option each time."""
    asked = []
    for _ in range(limit):
        question = client.get(f"/v1/prediction/results/{case_id}").json().get("question")
        if question is None:
            break
        asked.append(question)
        client.post(
            f"/v1/case/{case_id}/answers",
            json={"question_id": question["id"], "value": question["options"][0]},
        )
    return asked


def test_the_repairer_is_never_asked_about_the_crash(client):
    """Acceptance 1. He is standing at the car in a shop, possibly days later.
    Anything he would have had to witness is not a question he can answer."""
    cases.reset()
    for rego in ("QMN16", "PNS53", "RFH447"):
        cases.reset()
        report = open_case(client, rego)
        asked = _answer_every_question(client, report["case_id"])
        ids = {question["id"] for question in asked}
        assert not (ids & CRASH_QUESTIONS), f"{rego} asked about the crash: {ids}"
    cases.reset()


def test_a_question_names_a_real_part_of_this_vehicle(client):
    """Acceptance 5. Never a fixed string — the question is chosen from this
    case's own predictions, so it has to name one of them."""
    from app.catalogue import registry

    cases.reset()
    report = open_case(client, "PNS53")
    asked = _answer_every_question(client, report["case_id"])
    checks = [q for q in asked if q["id"].startswith("q_check_")]
    assert checks, "the Santa Fe has an uncertain, reachable, informative part"

    catalogue = registry.get("hyundai-santafe-pns53")
    for question in checks:
        part_id = question["id"].removeprefix("q_check_")
        part = catalogue.by_id.get(part_id)
        assert part is not None, f"{part_id} is not a part of this vehicle"
        assert part.name in question["text"], question["text"]
        assert question["options"] == ["Damaged", "Looks fine", "Can't tell"]
    cases.reset()


def test_the_part_asked_about_is_uncertain_reachable_and_the_best_one(client):
    """Acceptance 2. All three conditions, and it is the top such candidate —
    otherwise the interruption buys less than it could have."""
    from app.tables.constants import (
        CONSUMABLE_KLASSES,
        QUESTION_BAND_MAX,
        QUESTION_BAND_MIN,
        QUESTION_MIN_DOWNSTREAM,
    )

    cases.reset()
    catalogue, evidence, _ = _catalogue_and_edges("PNS53")
    report = _run(catalogue, evidence)
    question = report.question
    assert question is not None and question.id.startswith("q_check_")

    target = question.id.removeprefix("q_check_")
    chosen = next(i for i in report.inspections if i.part_id == target)

    assert chosen.accessible, "asked about something he cannot get to"
    p = report.predictions[target].p
    assert QUESTION_BAND_MIN <= p <= QUESTION_BAND_MAX, f"p={p:.3f} is already settled"
    assert chosen.downstream >= QUESTION_MIN_DOWNSTREAM

    eligible = [
        item
        for item in report.inspections
        if item.accessible
        and QUESTION_BAND_MIN <= report.predictions[item.part_id].p <= QUESTION_BAND_MAX
        and catalogue.by_id[item.part_id].klass not in CONSUMABLE_KLASSES
        and item.downstream >= QUESTION_MIN_DOWNSTREAM
    ]
    assert chosen.downstream == max(item.downstream for item in eligible)
    cases.reset()


def test_nothing_is_asked_when_nothing_would_move(client):
    """Acceptance 4. Every one of the Yaris's forty ranked candidates settles
    only itself — downstream is 0.0000 across the board — so once the side is
    known there is nothing worth interrupting for. Silence, not filler."""
    cases.reset()
    report = open_case(client)
    asked = _answer_every_question(client, report["case_id"])
    assert [q["id"] for q in asked] == ["q_side"], f"expected only q_side, got {asked}"

    after = client.get(f"/v1/prediction/results/{report['case_id']}").json()
    assert after["question"] is None
    cases.reset()


def test_answering_the_question_settles_the_part_and_moves_its_dependents():
    """Acceptance 3, on a fixed chain so the margin is exact. A question is
    only worth asking if the answer actually lands somewhere."""
    cover = part("cover", "bumper_cover", 0, side="C", name="Front Bumper Cover")
    absorber = part("absorber", "bumper_absorber", 2, side="C", name="Impact Absorber")
    beam = part("beam", "reinforcement_beam", 3, side="C", name="Reinforcement Beam")
    parts = [cover, absorber, beam]
    edges = [Edge("cover", "absorber", "load_path"), Edge("absorber", "beam", "load_path")]
    evidence = Evidence("front", "C", 4, {"cover": 0.95})

    base = graph.propagate(parts, edges, evidence)
    damaged = graph.propagate(parts, edges, _confirming(evidence, "absorber", True))
    fine = graph.propagate(parts, edges, _confirming(evidence, "absorber", False))

    # The part itself is settled either way.
    assert damaged["absorber"].p == 1.0
    assert fine["absorber"].p == 0.0
    # And what hangs off it moves, in both directions, by a real margin.
    assert damaged["beam"].p > base["beam"].p
    assert fine["beam"].p < base["beam"].p
    assert damaged["beam"].p - fine["beam"].p > 0.2


def test_answering_damaged_promotes_the_part_through_the_api(client):
    """The same thing end to end: the answer goes down the confirmation path,
    so it promotes the part and re-propagates rather than only being recorded."""
    cases.reset()
    report = open_case(client, "PNS53")
    case_id = report["case_id"]
    question = report["question"]
    assert question is not None and question["id"].startswith("q_check_")
    target = question["id"].removeprefix("q_check_")

    answered = client.post(
        f"/v1/case/{case_id}/answers",
        json={"question_id": question["id"], "value": "Damaged"},
    ).json()

    promoted = next(
        (line for line in answered["sections"]["visible"] if line["part_id"] == target),
        None,
    )
    assert promoted is not None, "answering Damaged must promote the part to visible"
    assert promoted["p"] == 1.0
    # And it is not asked again.
    assert (answered.get("question") or {}).get("id") != question["id"]
    cases.reset()


def test_cant_tell_leaves_the_part_where_it_was(client):
    """A guess is worse than the estimate it would replace, so "Can't tell"
    records nothing — but it is still marked asked, so it is not repeated."""
    cases.reset()
    report = open_case(client, "PNS53")
    case_id = report["case_id"]
    question = report["question"]
    assert question is not None and question["id"].startswith("q_check_")
    target = question["id"].removeprefix("q_check_")

    answered = client.post(
        f"/v1/case/{case_id}/answers",
        json={"question_id": question["id"], "value": "Can't tell"},
    ).json()

    # Not clamped either way: still an open prediction, not a settled fact.
    visible = {line["part_id"] for line in answered["sections"]["visible"]}
    assert target not in visible
    assert (answered.get("question") or {}).get("id") != question["id"]
    cases.reset()


def _run(catalogue, evidence):
    from app.engines import orchestrator
    from app.engines.history import EMPTY_HISTORY

    return orchestrator.run(catalogue.parts, catalogue.edges, evidence, EMPTY_HISTORY)
