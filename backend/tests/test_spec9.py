"""Spec 9 reference behaviour.

Two kinds of assertion:

Exact — rows of the 9.3 and 9.5 tables that are fully determined by the 9.2
formula plus the 9.0 constants and this repo's authored tables. The retainer row
and the crash-box gate row reproduce to three decimals; `own` reproduces for
every row of the 9.5 table.

Structural — properties the spec states in prose (monotone in severity, a scrape
touches nothing structural, settled parts sink from both ends). These hold for
any sane values of the ~40 authored rows, which spec 9.0 declares by shape but
does not enumerate.
"""

from __future__ import annotations

import pytest

from app.engines import counterfactual, graph
from app.engines.history import EMPTY_HISTORY, History, HistoryRow, cheng
from app.engines.types import Edge, Evidence, Part


def part(pid, klass, depth, side="R", zone="front", name=None, leak="default"):
    return Part(part_id=pid, name=name or pid, klass=klass, depth=depth,
                zone=zone, side=side, leak_class=leak)


@pytest.fixture
def front_end():
    """The 9.2 collapse sequence, observed set from the 9.3 reference scenario:
    cover, headlamp, grille, beam, guard."""
    parts = [
        part("cover", "bumper_cover", 0, side="C", name="Front Bumper Cover"),
        part("grille", "grille", 0, side="C", name="Front Bumper Grille"),
        part("headlamp", "headlamp", 1, name="Right Headlamp"),
        part("guard", "fender", 1, name="Right Front Guard"),
        part("retainer", "cover_retainer", 1, name="Cover Retainer - R", leak="consumable"),
        part("liner", "fender_liner", 2, name="Guard Liner - R", leak="consumable"),
        part("absorber", "bumper_absorber", 2, side="C", name="Impact Absorber"),
        part("beam", "reinforcement_beam", 3, side="C", name="Reinforcement Beam"),
        part("bracket", "lamp_bracket", 3, name="Headlamp Bracket - R"),
        part("harness", "harness", 3, name="Headlight Harness - R"),
        part("crashbox", "crash_box", 4, name="Crash Box - R", leak="structural"),
        part("radsupport", "radiator_support", 4, side="C", name="Radiator Support - Lower",
             leak="structural"),
        part("innerguard", "apron", 5, name="Inner Guard - R", leak="structural"),
        part("firewall", "firewall", 6, side="C", name="Firewall", leak="structural"),
    ]
    edges = [
        Edge("cover", "retainer", "hardware"),
        Edge("cover", "absorber", "load_path"),
        Edge("guard", "liner", "mounts"),
        Edge("headlamp", "bracket", "mounts"),
        Edge("headlamp", "harness", "harness"),
        Edge("absorber", "beam", "load_path"),
        Edge("beam", "crashbox", "load_path"),
        Edge("bracket", "radsupport", "mounts"),
        Edge("crashbox", "innerguard", "load_path"),
        Edge("innerguard", "firewall", "load_path"),
    ]
    return parts, edges


OBSERVED = {"cover": 0.98, "headlamp": 0.98, "grille": 0.98, "beam": 0.98, "guard": 0.98}


def run(parts, edges, severity, **kw):
    return graph.propagate(
        parts, edges, Evidence("front", "R", severity, dict(OBSERVED), **kw)
    )


# --- exact rows ---------------------------------------------------------------

def test_retainer_row_reproduces_exactly(front_end):
    """9.3 reference: cover retainer d1 = 0.665 / 0.978 / 0.989 at S1/S3/S5.

    Fully determined: leak 0.10, prior 0.90, cover observed 0.98 via the
    hardware edge at lambda 0.90, same-side zone 1.0.
    """
    parts, edges = front_end
    for severity, want in [(1, 0.665), (3, 0.978), (5, 0.989)]:
        got = run(parts, edges, severity)["retainer"].p
        assert got == pytest.approx(want, abs=0.002), f"S{severity}: {got:.3f} != {want}"


def test_crash_box_gate_row_reproduces(front_end):
    """9.3's gate table: with the gate on the edges, a severity-1 scrape leaves
    the crash box at 0.040 even though the beam in front of it is wrecked.
    This is the row that catches the gate-only-on-the-direct-term bug."""
    parts, edges = front_end
    got = run(parts, edges, 1)["crashbox"].p
    assert got == pytest.approx(0.040, abs=0.005), f"{got:.3f} != 0.040"


def test_ungated_edges_would_have_failed_that_row(front_end):
    """The embarrassing symptom, kept as a tripwire: if someone removes g from
    the edge terms, the severity-1 crash box balloons past 0.4 and this fires."""
    parts, edges = front_end
    p = run(parts, edges, 1)["crashbox"].p
    assert p < 0.10, (
        f"severity-1 crash box at {p:.3f} — the depth gate has come off the edges"
    )


@pytest.mark.parametrize(
    "p,want",
    [(0.448, 0.895), (0.629, 0.742), (0.617, 0.765), (0.327, 0.653),
     (0.886, 0.229), (0.978, 0.044), (0.017, 0.034)],
)
def test_own_reproduces_the_95_table(p, want):
    """own = 2·min(p, 1−p) reproduces every row of the 9.5 reference."""
    assert counterfactual._own(p) == pytest.approx(want, abs=0.002)


def test_cheng_reproduces_the_94_example():
    """Bracket on 80% of bumper jobs, 20% of the rest → 0.75, not 0.80."""
    assert cheng(80, 100, 20, 100) == pytest.approx(0.75)
    # No contrast, no causal power.
    assert cheng(50, 100, 50, 100) == 0.0


def test_history_blend_is_the_94_formula():
    """(n·λ_obs + K·prior) / (n + K) with K = 5, and the prior identically
    when there are no rows."""
    prior = EMPTY_HISTORY.lambda_for("reinforcement_beam", "crash_box", "load_path")
    assert prior == 0.55  # authored, returned identically

    rows = [HistoryRow("reinforcement_beam", "crash_box", "load_path", 20, 4)]
    got = History(rows).lambda_for("reinforcement_beam", "crash_box", "load_path")
    assert got == pytest.approx((20 * 0.2 + 5 * 0.55) / 25)


# --- structural claims ----------------------------------------------------------

def test_monotone_in_severity_on_every_part(front_end):
    """9.3: monotone in severity on every part."""
    parts, edges = front_end
    results = {s: run(parts, edges, s) for s in (1, 2, 3, 4, 5)}
    for pid in results[1]:
        if pid in OBSERVED:
            continue
        series = [results[s][pid].p for s in (1, 2, 3, 4, 5)]
        assert series == sorted(series), f"{pid} not monotone: {series}"


def test_a_scrape_touches_nothing_structural(front_end):
    """9.3: a car-park scrape correctly touches nothing structural."""
    parts, edges = front_end
    out = run(parts, edges, 1)
    for pid in ("crashbox", "radsupport", "innerguard", "firewall"):
        assert out[pid].p < 0.06, f"{pid} at {out[pid].p:.3f} on a severity-1 scrape"


def test_transverse_members_carry_damage_across_the_car():
    """9.3: no special left/right rule — the only route across is a transverse
    member. Shallow sided parts stay side-split; the far crash box picks up
    real probability through the centre beam."""
    parts = [
        part("cover", "bumper_cover", 0, side="C"),
        part("beam", "reinforcement_beam", 3, side="C"),
        part("bracketR", "lamp_bracket", 3, side="R"),
        part("bracketL", "lamp_bracket", 3, side="L"),
        part("lampR", "headlamp", 1, side="R"),
        part("crashR", "crash_box", 4, side="R", leak="structural"),
        part("crashL", "crash_box", 4, side="L", leak="structural"),
    ]
    edges = [
        Edge("cover", "beam", "load_path"),
        Edge("lampR", "bracketR", "mounts"),
        Edge("beam", "crashR", "load_path"),
        Edge("beam", "crashL", "load_path"),
    ]
    out = graph.propagate(
        parts, edges,
        Evidence("front", "R", 4, {"cover": 0.98, "lampR": 0.98, "beam": 0.98}),
    )
    bracket_ratio = out["bracketR"].p / max(out["bracketL"].p, 1e-9)
    crash_ratio = out["crashR"].p / max(out["crashL"].p, 1e-9)
    # Two different ratios from one mechanism (9.3): brackets split hard,
    # crash boxes barely, because the beam feeds both sides.
    assert bracket_ratio > 3.0
    assert crash_ratio < 2.0
    assert out["crashL"].p > 0.15, "the far-side crash box must stay worth checking"


def test_inspect_value_settles_from_both_ends(front_end):
    """9.5 reference shape: retainer (0.978) and firewall (0.017) rank below
    every genuinely uncertain part."""
    parts, edges = front_end
    evidence = Evidence("front", "R", 3, dict(OBSERVED), exposed_depth=1)
    predictions = graph.propagate(parts, edges, evidence)
    ranked = counterfactual.rank_inspections(parts, edges, evidence, predictions)
    by_id = {i.part_id: i for i in ranked}

    uncertain_values = [
        by_id[pid].value for pid in ("bracket", "harness", "absorber") if pid in by_id
    ]
    for settled in ("retainer", "firewall"):
        if settled in by_id:
            assert all(by_id[settled].value < v for v in uncertain_values)


def test_accessibility_is_depth_against_exposure(front_end):
    """9.5: accessible = depth <= exposed_depth + 2. Bumper off (exposed 1)
    reaches depth 3; the crash box at 4 is blocked."""
    parts, edges = front_end
    evidence = Evidence("front", "R", 3, dict(OBSERVED), exposed_depth=1)
    predictions = graph.propagate(parts, edges, evidence)
    ranked = {i.part_id: i for i in
              counterfactual.rank_inspections(parts, edges, evidence, predictions)}
    if "bracket" in ranked:
        assert ranked["bracket"].accessible is True
    if "crashbox" in ranked:
        assert ranked["crashbox"].accessible is False


def test_attribution_shape_matches_the_92_example(front_end):
    """The bracket's causes: the headlamp through mounts ahead of the base
    rate, with shares summing to 1 — the 9.2 attribution example's shape."""
    parts, edges = front_end
    out = run(parts, edges, 3)
    attribution = out["bracket"].attribution
    assert attribution, "the bracket must have an attribution"
    assert sum(c.share for c in attribution) == pytest.approx(1.0, abs=0.02)
    causes = {c.cause: c for c in attribution}
    assert "Right Headlamp" in causes and causes["Right Headlamp"].relation == "mounts"
    assert causes["Right Headlamp"].share > causes.get(
        "base rate", type("z", (), {"share": 0.0})
    ).share
