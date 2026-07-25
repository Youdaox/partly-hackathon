"""Repair history as a Beta blend over the hand-authored edge priors.

History does not predict anything. It supplies one number — lambda — into
engines.graph (spec 5.2). With no history loaded, lambda is exactly the value in
tables.edge_prior; as real co-occurrence counts arrive, lambda moves towards the
observed rate at a speed set by HISTORY_PRIOR_STRENGTH.

Treating the authored prior as a Beta(alpha, beta) pseudo-count means a relation
seen four times cannot overturn a prior, but one seen four thousand times will.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.tables.constants import HISTORY_PRIOR_STRENGTH
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
        self._strength = HISTORY_PRIOR_STRENGTH if strength is None else strength
        self._rows: dict[tuple[str, str, str], HistoryRow] = {}
        for row in rows or []:
            self._rows[(row.klass_from, row.klass_to, row.relation)] = row

    def lambda_for(self, klass_from: str, klass_to: str, relation: str) -> float:
        """Resolve the edge strength for a (from, to, relation) triple."""
        prior = self._prior(klass_from, klass_to, relation)
        row = self._rows.get((klass_from, klass_to, relation))
        if row is None or row.n_trials <= 0:
            return prior

        # Beta blend: the prior is worth `strength` pseudo-trials.
        alpha = prior * self._strength + row.n_success
        beta = (1.0 - prior) * self._strength + (row.n_trials - row.n_success)
        total = alpha + beta
        if total <= 0:
            return prior
        return max(0.0, min(1.0, alpha / total))

    @staticmethod
    def _prior(klass_from: str, klass_to: str, relation: str) -> float:
        direct = EDGE_PRIOR.get((klass_from, klass_to, relation))
        if direct is not None:
            return direct
        if relation == "hardware":
            # A fastener consumed by removing any parent behaves much the same.
            return EDGE_PRIOR.get(("bumper_cover", "clip", "hardware"), 0.6)
        if relation == "sub_assembly":
            return SUB_ASSEMBLY_LAMBDA
        return DEFAULT_ADJACENT_LAMBDA

    def stats(self) -> dict[str, int]:
        return {
            "rows": len(self._rows),
            "trials": sum(r.n_trials for r in self._rows.values()),
            "authored_priors": len(EDGE_PRIOR),
        }


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


# Default instance: authored priors only, no history.
EMPTY_HISTORY = History()
