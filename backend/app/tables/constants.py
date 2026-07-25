"""Tuning constants. Plain data — no functions, no conditionals (spec 5.1)."""

# --- Severity ladder -------------------------------------------------------
# How deep into the vehicle a collision of each severity is expected to reach.
# Indexed by severity 1..5; the value is a depth on the same 0..6 scale as
# tables.depth_map. Fractional on purpose: it is the centre of a sigmoid, not a cutoff.
REACH: dict[int, float] = {
    1: 0.4,   # scuffed paint, cosmetic
    2: 1.4,   # a lamp or a panel is gone
    3: 3.0,   # through the bumper system into the beam
    4: 4.6,   # cooling pack and mounting structure
    5: 6.0,   # rails, subframe, restraints
}
DEFAULT_SEVERITY = 3

# Width of the depth sigmoid. Larger = softer gate, more deep parts survive.
SIGMOID_WIDTH = 0.9

# --- Zone / side matching --------------------------------------------------
# Multiplier applied to a part whose location disagrees with the impact.
ZONE_FACTOR = {
    "match": 1.0,          # same zone, same side
    "side_mismatch": 0.18,  # right-hand impact, left-hand part
    "centre": 0.85,        # part is centre-line, so side does not apply
    "zone_mismatch": 0.05,  # front impact, rear part
    # A part whose name carries no location at all. Low on purpose: on a real
    # catalogue this is 4,000-odd engine internals and interior trim, and a
    # generous default would drag all of them into every candidate set.
    "unknown": 0.12,
}

# --- Leak ------------------------------------------------------------------
# Base rate that a part is replaced for reasons the graph does not model.
LEAK = {
    "consumable": 0.10,   # clips, retainers, one-time-use fasteners
    "structural": 0.015,
    "default": 0.03,
}

# --- Propagation -----------------------------------------------------------
# Below this an edge is not worth traversing; keeps the sweep inside its budget.
MIN_EDGE_CONTRIBUTION = 0.002
# Ceiling on a propagated (unobserved) probability, so inference never presents
# as certainty. Observations and confirmations are exempt.
MAX_PROPAGATED_P = 0.97

# --- Buckets (spec 6.8) ----------------------------------------------------
ORDER_THRESHOLD = 0.80   # confident enough to put on the order now
CHECK_MIN = 0.20         # below this it is not worth a repairer's time
CAP_VISIBLE = 12
CAP_ORDER = 8
CAP_CHECK = 5            # hard cap

# --- Counterfactual --------------------------------------------------------
# A part deeper than exposed_depth + this is not reachable without more teardown,
# so it is a poor thing to ask someone to go and look at.
ACCESSIBLE_MARGIN = 1
# Value multiplier for a part that is not yet accessible.
INACCESSIBLE_PENALTY = 0.35

# --- History blend ---------------------------------------------------------
# Beta prior strength: how many observations of real history it takes to move
# lambda away from the hand-authored edge_prior.
HISTORY_PRIOR_STRENGTH = 40.0
