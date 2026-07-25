"""Repair history as a Beta blend over the hand-authored edge priors (spec 9.4).

History does not predict anything. It supplies one number — λ — into
engines.graph (spec 5.2). The blend is one line:

    λ_final = (n · λ_obs + K · prior) / (n + K)        K = 5

Equivalently a Beta posterior with the authored prior worth K pseudo-trials.
File missing, key absent, or n_trials = 0 → the authored prior, identically,
not approximately. With many rows, data dominates. One formula spans cold start
and full production, and nothing else in the system changes as data arrives.

Parameters are keyed by canonical class pair, never by part number: there are
millions of part numbers and ~120 classes, and class-level tying is the
mechanism by which one Yaris teardown informs a Prius prediction.

Production estimator (spec 9.4): when real co-occurrence data lands, λ must be
Cheng's causal power, NOT the observational conditional P(B|A) — see `cheng()`.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.tables.constants import PRIOR_STRENGTH
from app.tables.edge_prior import (
    DEFAULT_ADJACENT_LAMBDA,
    EDGE_PRIOR,
    SUB_ASSEMBLY_LAMBDA,
)


@dataclass(frozen=True, slots=True)
class HistoryRow:
    klass_from: str
    klass_to: str
    relation: str
    n_trials: int
    n_success: int
    vehicle_class: str = "any"


class History:
    """Immutable once built. Hot-swappable via `reload`, which returns a new one."""

    __slots__ = ("_rows", "_strength")

    def __init__(self, rows: list[HistoryRow] | None = None, strength: float | None = None):
        self._strength = PRIOR_STRENGTH if strength is None else strength
        self._rows: dict[tuple[str, str, str, str], HistoryRow] = {}
        for row in rows or []:
            key = (row.klass_from, row.klass_to, row.relation, row.vehicle_class)
            self._rows[key] = row

    def lambda_for(
        self,
        klass_from: str,
        klass_to: str,
        relation: str,
        vehicle_class: str = "any",
    ) -> float:
        """Resolve the edge strength for a (from, to, relation) triple."""
        prior = self._prior(klass_from, klass_to, relation)
        row = self._rows.get((klass_from, klass_to, relation, vehicle_class))
        if row is None and vehicle_class != "any":
            row = self._rows.get((klass_from, klass_to, relation, "any"))
        if row is None or row.n_trials <= 0:
            return prior

        lam_obs = row.n_success / row.n_trials
        blended = (row.n_trials * lam_obs + self._strength * prior) / (
            row.n_trials + self._strength
        )
        return max(0.0, min(1.0, blended))

    @staticmethod
    def _prior(klass_from: str, klass_to: str, relation: str) -> float:
        direct = EDGE_PRIOR.get((klass_from, klass_to, relation))
        if direct is not None:
            return direct
        if relation == "hardware":
            # A fastener consumed by removing any parent behaves much the same.
            return EDGE_PRIOR.get(("bumper_cover", "cover_retainer", "hardware"), 0.6)
        if relation == "sub_assembly":
            return SUB_ASSEMBLY_LAMBDA
        return DEFAULT_ADJACENT_LAMBDA

    def stats(self) -> dict:
        """Shape from spec 9.4 — the UI shows `edges with data: 0 → 40` when a
        seed file is dropped in, and needs nothing else to support that beat."""
        with_data = {
            (row.klass_from, row.klass_to, row.relation)
            for row in self._rows.values()
            if row.n_trials > 0
        }
        return {
            "edges_total": len(EDGE_PRIOR),
            "edges_with_data": len(with_data),
            "rows": len(self._rows),
        }


def cheng(n_b_given_a: int, n_a: int, n_b_given_not_a: int, n_not_a: int) -> float:
    """Cheng's causal power: the λ to write into repair_history from real counts.

        λ_AB = [ P(B|A) − P(B|¬A) ] / [ 1 − P(B|¬A) ]

    NOT P(B|A): the observational conditional bundles in every other cause of
    B's damage and does not compose in a noisy-OR (spec 9.2). If a bracket
    appears on 80% of jobs where the bumper was replaced and 20% where it was
    not, the causal power is (0.8 − 0.2)/(1 − 0.2) = 0.75 — the naive 0.80
    attributes background bracket damage to the bumper. Four counts per edge,
    one GROUP BY per class pair.
    """
    if n_a <= 0:
        return 0.0
    p_b_a = n_b_given_a / n_a
    p_b_not_a = (n_b_given_not_a / n_not_a) if n_not_a > 0 else 0.0
    if p_b_not_a >= 1.0:
        return 0.0
    return max(0.0, (p_b_a - p_b_not_a) / (1.0 - p_b_not_a))


def parse_cooccurrence_csv(text: str) -> list[HistoryRow]:
    """Parse data/history/cooccurrence.csv. Absent on day one (spec 7.5)."""
    rows: list[HistoryRow] = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return rows
    header = [h.strip() for h in lines[0].split(",")]
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(",")]
        if len(cells) != len(header):
            continue
        record = dict(zip(header, cells))
        try:
            rows.append(
                HistoryRow(
                    klass_from=record["klass_from"],
                    klass_to=record["klass_to"],
                    relation=record["relation"],
                    n_trials=int(record["n_trials"]),
                    n_success=int(record["n_success"]),
                    vehicle_class=record.get("vehicle_class", "any"),
                )
            )
        except (KeyError, ValueError):
            continue
    return rows


def reload(csv_text: str | None = None) -> History:
    """Build a fresh History from a dropped-in seed file. The demo beat."""
    if not csv_text:
        return History()
    return History(parse_cooccurrence_csv(csv_text))


# Default instance: authored priors only, no history.
EMPTY_HISTORY = History()
