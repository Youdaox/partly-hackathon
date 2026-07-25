"""Engine behaviour, asserted without a database or a network.

Spec 9 (the reference numbers this file was meant to assert against) was not
supplied, so these assert the *properties* the spec states in prose — monotonicity,
gating, the noisy-OR decomposition, the caps, the confirm semantics — rather than
fixed probabilities. Swap in the reference table when it lands.
"""

from __future__ import annotations

import pytest

from app.engines import buckets, counterfactual, graph, orchestrator, physics
from app.engines.history import EMPTY_HISTORY, History, HistoryRow
from app.engines.types import Edge, Evidence, Part
from app.tables.constants import CAP_ORDER, CAP_VISIBLE, MAX_CHECK, ORDER_MIN


def part(pid, klass, depth, zone="front", side="C", **kw):
    return Part(part_id=pid, name=kw.pop("name", pid), klass=klass, depth=depth,
                zone=zone, side=side, **kw)


@pytest.fixture
def chain():
    """cover -(hardware)-> retainer, cover -(load_path)-> absorber -> beam."""
    parts = [
        part("cover", "bumper_cover", 0),
        part("retainer", "cover_retainer", 2, side="R"),
        part("absorber", "bumper_absorber", 2),
        part("beam", "reinforcement_beam", 3),
        part("rail", "side_member", 5),
        part("taillamp", "tail_lamp", 1, zone="rear"),
    ]
    edges = [
        Edge("cover", "retainer", "hardware"),
        Edge("cover", "absorber", "load_path"),
        Edge("absorber", "beam", "load_path"),
        Edge("beam", "rail", "load_path"),
    ]
    return parts, edges


# --- physics ----------------------------------------------------------------

def test_depth_gate_falls_with_depth():
    gates = [physics.depth_gate(d, 3) for d in range(7)]
    assert gates == sorted(gates, reverse=True)


def test_depth_gate_rises_with_severity():
    assert physics.depth_gate(4, 5) > physics.depth_gate(4, 3) > physics.depth_gate(4, 1)


def test_zone_mismatch_suppresses_hardest():
    p = part("x", "headlamp", 1, zone="front", side="R")
    match = physics.zone_factor(p, "front", "R")
    wrong_side = physics.zone_factor(p, "front", "L")
    wrong_zone = physics.zone_factor(p, "rear", "R")
    assert match > wrong_side > wrong_zone


def test_centreline_parts_ignore_side():
    p = part("x", "bumper_cover", 0, zone="front", side="C")
    assert physics.zone_factor(p, "front", "L") == physics.zone_factor(p, "front", "R")


# --- graph ------------------------------------------------------------------

def test_damage_propagates_down_the_chain(chain):
    parts, edges = chain
    evidence = Evidence(zone="front", side="R", severity=3, observations={"cover": 0.98})
    out = graph.propagate(parts, edges, evidence)

    assert out["cover"].p > 0.9
    assert out["retainer"].p > 0.5, "a detached cover implies broken retainers"
    # Strictly decreasing along the load path.
    assert out["absorber"].p > out["beam"].p > out["rail"].p


def test_no_evidence_at_severity_one_stays_cosmetic(chain):
    """With nothing observed and a severity-1 scrape, nothing structural fires.

    Note severity alone IS evidence under spec 9.2 — asserting severity 3 with
    no named parts still predicts skin damage through the root term, which is
    correct: the ladder levels are defined by what reached where.
    """
    parts, edges = chain
    out = graph.propagate(parts, edges, Evidence(zone="front", side="R", severity=1))
    assert all(p.p < 0.45 for p in out.values())
    assert out["beam"].p < 0.10 and out["rail"].p < 0.05


def test_wrong_zone_part_stays_cold(chain):
    parts, edges = chain
    evidence = Evidence(zone="front", side="R", severity=5, observations={"cover": 0.98})
    out = graph.propagate(parts, edges, evidence)
    assert out["taillamp"].p < 0.05, "a front impact must not implicate a tail lamp"


def test_severity_gates_depth(chain):
    parts, edges = chain
    light = graph.propagate(parts, edges, Evidence("front", "R", 1, {"cover": 0.98}))
    heavy = graph.propagate(parts, edges, Evidence("front", "R", 5, {"cover": 0.98}))
    assert heavy["rail"].p > light["rail"].p


def test_attribution_shares_sum_to_one(chain):
    parts, edges = chain
    out = graph.propagate(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    for prediction in out.values():
        if prediction.attribution:
            assert sum(c.share for c in prediction.attribution) == pytest.approx(1.0, abs=0.02)


def test_attribution_names_the_real_cause(chain):
    """The wrecked cover must appear as a named cause of the retainer, with the
    hardware relation. (The direct-impact root term can legitimately outrank it
    at matching depth, so "present and correctly labelled" is the contract.)"""
    parts, edges = chain
    out = graph.propagate(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    causes = {(c.cause, c.relation) for c in out["retainer"].attribution}
    assert ("cover", "hardware") in causes


def test_confirmation_clamps_hard(chain):
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98}, confirmations={"beam": True})
    out = graph.propagate(parts, edges, evidence)
    assert out["beam"].p == 1.0
    assert out["beam"].confirmed is True


def test_rejection_clamps_to_zero_and_stops_propagation(chain):
    parts, edges = chain
    baseline = graph.propagate(parts, edges, Evidence("front", "R", 4, {"cover": 0.98}))
    rejected = graph.propagate(
        parts, edges,
        Evidence("front", "R", 4, {"cover": 0.98}, confirmations={"beam": False}),
    )
    assert rejected["beam"].p == 0.0
    assert rejected["rail"].p < baseline["rail"].p, "a clean beam should cool the rail"


def test_full_clamp_set_is_applied_not_just_the_newest(chain):
    """Spec 7.4: confirmations accumulate."""
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98},
                        confirmations={"beam": True, "absorber": False})
    out = graph.propagate(parts, edges, evidence)
    assert out["beam"].p == 1.0 and out["absorber"].p == 0.0


def test_observed_parts_take_the_observation_directly(chain):
    """Spec 9.2 pseudocode: observed parts short-circuit. The graph never
    argues with what a camera or a repairer has actually seen — channel
    reinforcement happens upstream in evidence_service, across sources."""
    parts, edges = chain
    out = graph.propagate(
        parts, edges, Evidence("front", "R", 3, {"cover": 0.98, "retainer": 0.6})
    )
    assert out["retainer"].p == 0.6
    assert out["retainer"].observed is True


def test_propagation_is_deterministic(chain):
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98})
    first = graph.propagate(parts, edges, evidence)
    second = graph.propagate(list(reversed(parts)), edges, evidence)
    assert {k: round(v.p, 9) for k, v in first.items()} == {
        k: round(v.p, 9) for k, v in second.items()
    }


def test_cycles_cannot_hang_the_sweep():
    parts = [part("a", "bumper_cover", 0), part("b", "cover_retainer", 2)]
    edges = [Edge("a", "b", "hardware"), Edge("b", "a", "hardware")]
    out = graph.propagate(parts, edges, Evidence("front", "C", 3, {"a": 0.9}))
    assert set(out) == {"a", "b"}


# --- history ----------------------------------------------------------------

def test_empty_history_returns_the_authored_prior():
    """Identically, not approximately (spec 9.4)."""
    assert EMPTY_HISTORY.lambda_for("bumper_cover", "cover_retainer", "hardware") == 0.90


def test_history_moves_lambda_towards_observation():
    rows = [HistoryRow("bumper_cover", "cover_retainer", "hardware", 4000, 400)]
    blended = History(rows).lambda_for("bumper_cover", "cover_retainer", "hardware")
    assert 0.1 < blended < 0.92, "plentiful contrary history should drag the prior down"


def test_thin_history_moves_but_does_not_overturn():
    """K = 5: four contrary observations pull hard but the prior still holds
    ground — (0·4 + 5·0.9)/9 = 0.5. One confirmed teardown visibly moving a
    number is the live-learning demo beat, and it is real updating."""
    rows = [HistoryRow("bumper_cover", "cover_retainer", "hardware", 4, 0)]
    blended = History(rows).lambda_for("bumper_cover", "cover_retainer", "hardware")
    assert abs(blended - 0.5) < 0.01
    assert 0.0 < blended < 0.90


# --- counterfactual ---------------------------------------------------------

def test_settled_parts_sink_from_both_ends(chain):
    """Spec 9.5: the retainer at 0.98 and the firewall at 0.02 are equally not
    worth looking at — near-certain parts rank below genuinely uncertain ones."""
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    assert ranked, "something should be rankable"
    top_p = predictions[ranked[0].part_id].p
    assert 0.15 < top_p < 0.85, f"top-ranked part should be uncertain, got {top_p}"


def test_inspection_order_is_accessible_first_then_value(chain):
    """Spec 9.5: accessible first, value desc within each group. A blocked part
    can carry more value than an accessible one and still sort after it."""
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    assert ranked, "something should be worth checking"
    assert ranked[0].rank == 1

    accessible = [i for i in ranked if i.accessible]
    blocked = [i for i in ranked if not i.accessible]
    assert ranked == accessible + blocked
    for group in (accessible, blocked):
        assert group == sorted(group, key=lambda i: i.value, reverse=True)


def test_inaccessible_parts_sort_after_accessible_ones(chain):
    """Spec 9.5: accessibility does not discount value — the information is
    worth the same once the car is apart — it just sorts blocked parts last."""
    parts, edges = chain
    evidence = Evidence("front", "R", 4, {"cover": 0.98}, exposed_depth=0)
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    flags = [item.accessible for item in ranked]
    assert flags == sorted(flags, reverse=True), "accessible must come first"


def _sided_fixture():
    """Enough sided parts that a side answer flips >= 3 buckets (spec 9.5 bar)."""
    parts = [
        part("cover", "bumper_cover", 0),
        part("lampR", "headlamp", 1, side="R", name="lampR"),
        part("retainerR", "cover_retainer", 1, side="R", name="retainerR"),
        part("linerR", "fender_liner", 2, side="R", name="linerR"),
        part("bracketR", "lamp_bracket", 3, side="R", name="bracketR"),
        part("lampL", "headlamp", 1, side="L", name="lampL"),
        part("retainerL", "cover_retainer", 1, side="L", name="retainerL"),
        part("linerL", "fender_liner", 2, side="L", name="linerL"),
        part("bracketL", "lamp_bracket", 3, side="L", name="bracketL"),
    ]
    edges = [
        Edge("cover", "retainerR", "hardware"),
        Edge("cover", "retainerL", "hardware"),
        Edge("lampR", "bracketR", "mounts"),
        Edge("lampL", "bracketL", "mounts"),
    ]
    return parts, edges


def test_side_conflict_produces_a_question():
    parts, edges = _sided_fixture()
    evidence = Evidence("front", "C", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    question = counterfactual.next_question(
        parts, edges, evidence, predictions,
        conflicts=[{"field": "side", "values": ["L", "R"]}],
    )
    assert question is not None and question.id == "q_side"


def test_a_question_is_never_asked_twice():
    """Spec 9.5: no question already asked this case."""
    parts, edges = _sided_fixture()
    evidence = Evidence("front", "C", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    question = counterfactual.next_question(
        parts, edges, evidence, predictions,
        conflicts=[{"field": "side", "values": ["L", "R"]}],
        # A live side conflict, but the side has already been settled once.
        asked=frozenset({"q_side"}),
    )
    assert question is None


# --- buckets ----------------------------------------------------------------

def test_caps_are_hard(chain):
    parts = [part(f"p{i}", "cover_retainer", 2) for i in range(40)]
    edges = []
    predictions = {
        p.part_id: graph.Prediction(part_id=p.part_id, p=0.5, reason="") for p in parts
    }
    sections = buckets.split(predictions, {p.part_id: p for p in parts})
    assert len(sections.check) <= MAX_CHECK
    assert len(sections.order) <= CAP_ORDER
    assert len(sections.visible) <= CAP_VISIBLE


def test_dedupe_runs_before_the_cap_not_after():
    """Found on a real Yaris report: the catalogue lists one physical part
    once per fitted position, so a corner can carry the same part name under
    six different part ids. Six duplicate rows at p=1.0 filled every
    CAP_ORDER slot ahead of a distinct, lower-scoring real part sitting right
    behind them. Dedup must happen inside buckets.split, before truncation —
    a dedup that only ran downstream (as report_service's used to) is too
    late to save the slot.
    """
    duplicate_part_id = "shared_number"
    parts = {}
    predictions = {}
    # Six rows, same name and part_number, all p=1.0 — the duplicate spam.
    for i in range(6):
        pid = f"dup{i}"
        parts[pid] = Part(
            part_id=pid, name="Right Front Guard Grommet", klass="clip", depth=2,
            zone="front", side="R", part_number=duplicate_part_id,
        )
        predictions[pid] = graph.Prediction(part_id=pid, p=1.0, reason="")
    # One genuinely distinct part, scored lower, that a duplicate-blind cap
    # of 8 would never have room for if the six duplicates all counted.
    distinct = Part(part_id="real", name="Headlight Wiring Harness", klass="harness",
                    depth=3, zone="front", side="R", part_number="different")
    parts["real"] = distinct
    predictions["real"] = graph.Prediction(part_id="real", p=0.97, reason="")

    sections = buckets.split(predictions, parts)
    order_ids = {p.part_id for p in sections.order}
    assert "real" in order_ids, "a distinct part must not be crowded out by duplicate rows"
    # The six grommets collapse to one, and that one is a fastener, so it is
    # grouped rather than given a slot of its own — leaving the order bucket to
    # the distinct part the duplicates used to bury.
    assert len(sections.order) == 1
    assert len(sections.consumables) == 1, "six duplicate rows must collapse to one"


def test_rejected_parts_leave_the_report(chain):
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98}, confirmations={"retainer": False})
    report = orchestrator.run(parts, edges, evidence)
    everything = report.sections.visible + report.sections.order + report.sections.check
    assert "retainer" not in {p.part_id for p in everything}


def test_observed_parts_are_visible_not_order(chain):
    parts, edges = chain
    report = orchestrator.run(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    assert "cover" in {p.part_id for p in report.sections.visible}
    assert "cover" not in {p.part_id for p in report.sections.order}


# --- orchestrator -----------------------------------------------------------

def test_confirm_skips_ranking_for_the_150ms_budget(chain):
    parts, edges = chain
    report = orchestrator.confirm(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    assert report.inspections == []
    assert report.question is None


def test_engine_touches_no_io():
    """The purity rule of spec 5.1, enforced by import inspection."""
    import ast
    import pathlib

    banned = {"app.services", "app.models", "app.ai", "app.database", "app.store",
              "app.api", "app.catalogue"}
    engine_dir = pathlib.Path(__file__).resolve().parents[1] / "app" / "engines"
    for source in engine_dir.glob("*.py"):
        tree = ast.parse(source.read_text())
        for node in ast.walk(tree):
            module = None
            if isinstance(node, ast.ImportFrom):
                module = node.module
            elif isinstance(node, ast.Import):
                module = node.names[0].name
            if module and any(module.startswith(b) for b in banned):
                raise AssertionError(f"{source.name} imports {module}, breaking engine purity")
