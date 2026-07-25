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
from app.tables.constants import CAP_CHECK, CAP_ORDER, CAP_VISIBLE, ORDER_THRESHOLD


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


def test_no_evidence_leaves_only_base_rates(chain):
    parts, edges = chain
    out = graph.propagate(parts, edges, Evidence(zone="front", side="R", severity=3))
    assert all(prediction.p < 0.2 for prediction in out.values())


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
    parts, edges = chain
    out = graph.propagate(parts, edges, Evidence("front", "R", 3, {"cover": 0.98}))
    top = out["retainer"].attribution[0]
    assert top.cause == "cover"
    assert top.relation == "hardware"


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


def test_observation_and_graph_reinforce(chain):
    """A part both seen and structurally implied beats either alone."""
    parts, edges = chain
    seen_only = graph.propagate(parts, edges, Evidence("front", "R", 3, {"retainer": 0.6}))
    both = graph.propagate(
        parts, edges, Evidence("front", "R", 3, {"cover": 0.98, "retainer": 0.6})
    )
    assert both["retainer"].p > seen_only["retainer"].p


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
    assert EMPTY_HISTORY.lambda_for("bumper_cover", "cover_retainer", "hardware") == 0.92


def test_history_moves_lambda_towards_observation():
    rows = [HistoryRow("bumper_cover", "cover_retainer", "hardware", 4000, 400)]
    blended = History(rows).lambda_for("bumper_cover", "cover_retainer", "hardware")
    assert 0.1 < blended < 0.92, "plentiful contrary history should drag the prior down"


def test_thin_history_barely_moves_the_prior():
    rows = [HistoryRow("bumper_cover", "cover_retainer", "hardware", 4, 0)]
    blended = History(rows).lambda_for("bumper_cover", "cover_retainer", "hardware")
    assert blended > 0.8, "four observations must not overturn an authored prior"


# --- counterfactual ---------------------------------------------------------

def test_certain_parts_are_not_worth_inspecting(chain):
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    for inspection in ranked:
        assert predictions[inspection.part_id].p < ORDER_THRESHOLD


def test_inspection_value_prefers_uncertainty(chain):
    parts, edges = chain
    evidence = Evidence("front", "R", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    assert ranked, "something should be worth checking"
    assert ranked[0].rank == 1
    assert ranked == sorted(ranked, key=lambda i: i.value, reverse=True)


def test_inaccessible_parts_are_penalised(chain):
    parts, edges = chain
    shallow = Evidence("front", "R", 4, {"cover": 0.98}, exposed_depth=5)
    deep = Evidence("front", "R", 4, {"cover": 0.98}, exposed_depth=0)
    p_shallow = graph.propagate(parts, edges, shallow)
    p_deep = graph.propagate(parts, edges, deep)
    by_shallow = {i.part_id: i for i in
                  counterfactual.rank_inspections(parts, edges, shallow, p_shallow)}
    by_deep = {i.part_id: i for i in
               counterfactual.rank_inspections(parts, edges, deep, p_deep)}
    common = set(by_shallow) & set(by_deep)
    assert any(by_shallow[pid].value > by_deep[pid].value for pid in common)


def test_side_conflict_produces_a_question(chain):
    parts, edges = chain
    evidence = Evidence("front", "C", 3, {"cover": 0.98})
    predictions = graph.propagate(parts, edges, evidence)
    question = counterfactual.next_question(
        parts, edges, evidence, predictions,
        conflicts=[{"field": "side", "values": ["L", "R"]}],
    )
    assert question is not None and question.value > 0


# --- buckets ----------------------------------------------------------------

def test_caps_are_hard(chain):
    parts = [part(f"p{i}", "cover_retainer", 2) for i in range(40)]
    edges = []
    predictions = {
        p.part_id: graph.Prediction(part_id=p.part_id, p=0.5, reason="") for p in parts
    }
    sections = buckets.split(predictions, {p.part_id: p for p in parts})
    assert len(sections.check) <= CAP_CHECK
    assert len(sections.order) <= CAP_ORDER
    assert len(sections.visible) <= CAP_VISIBLE


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
