"""Tuning constants. Plain data — no functions, no conditionals (spec 5.1).

Values are spec 9.0 where given; anything not in 9.0 is marked local.
"""

# --- Severity ladder (spec 9.0 / 9.3) ---------------------------------------
# How deep a collision of each severity is expected to reach, on the same 0..6
# scale as tables.depth_map. Fractional on purpose: it is the centre of a
# sigmoid, not a cutoff. The ladder itself is ordinal and evidence-defined —
# each level is something you can point at in a photo.
REACH: dict[int, float] = {1: 0.8, 2: 2.0, 3: 3.3, 4: 4.5, 5: 6.0}
DEFAULT_SEVERITY = 3

# Width of the depth sigmoid (spec 9.0).
SIGMOID_WIDTH = 0.8

# --- Zone / side (spec 9.0) --------------------------------------------------
# Multiplies ONLY the direct (root) cause — never the edges and never the whole
# probability. Direction across the car needs no special rule beyond this: the
# only route from a left-side part to a right-side one is a transverse member,
# modelled explicitly as a centre part.
ZONE_FACTOR = {
    "same_side": 1.0,
    "centre": 0.4,
    "other_side": 0.15,
    "adjacent": 0.15,
    "elsewhere": 0.0,
}

# --- Leak (spec 9.0) ----------------------------------------------------------
# Base rate that a part is replaced for reasons the graph does not model.
# Deliberately NOT gated by depth: "gets replaced anyway" is invoice behaviour,
# not crash physics.
LEAK = {
    "consumable": 0.10,
    "structural": 0.02,
    "default": 0.03,
}

# --- History blend (spec 9.0 / 9.4) -------------------------------------------
# K: how many observed trials it takes for real history to pull even with the
# authored prior. Small on purpose — one confirmed teardown should visibly move
# a thin edge, which is real Bayesian updating rather than theatre.
PRIOR_STRENGTH = 5

# --- Buckets (spec 9.0 / 9.6) --------------------------------------------------
ORDER_MIN = 0.60     # p >= this: ordering now is the cheaper mistake
CHECK_MIN = 0.15     # below this a part is never shown
MAX_CHECK = 5        # hard cap on the check section
MAX_INSPECT = 3      # inspect_first list cap
CAP_VISIBLE = 12
CAP_ORDER = 8

# --- Counterfactual (spec 9.5) --------------------------------------------------
# accessible_i = depth_i <= exposed_depth + ACCESSIBLE_MARGIN
ACCESSIBLE_MARGIN = 2
# A question is only worth the interruption when at least this many parts would
# change bucket depending on the answer.
QUESTION_MIN_BUCKET_MOVES = 3

# --- Propagation (local, not in 9.0) --------------------------------------------
# Below this an edge is not worth traversing; keeps the sweep inside its budget.
MIN_EDGE_CONTRIBUTION = 0.002
