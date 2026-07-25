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

# --- Clarifying question (local) ---------------------------------------------
# The assistant asks at most one question, and it has to be one the repairer can
# answer by looking at the car in front of him. It used to ask about the crash —
# "are the wheels sitting straight?", "did the airbags go off?" — which he never
# saw, and which were the same three every time regardless of the damage.
#
# The replacement is chosen from this case's own predictions: a part that is
# genuinely undecided, that he can reach right now, and whose answer moves the
# rest of the report.

# Genuinely undecided. Outside this band the answer changes nothing: a part at
# 0.9 is already ordered and one at 0.1 is already ignored.
QUESTION_BAND_MIN = 0.35
QUESTION_BAND_MAX = 0.70

# How much the rest of the report must move, in summed probability, before the
# interruption is worth it. Measured on `downstream` rather than the total
# inspection value, because `value` is dominated by the part's own uncertainty:
# on the Yaris every in-band part scores ~0.96 on own alone while settling
# nothing else, and asking about those is a filler question with a good score.
QUESTION_MIN_DOWNSTREAM = 0.75

# --- Counterfactual (spec 9.5) --------------------------------------------------
# accessible_i = depth_i <= exposed_depth + ACCESSIBLE_MARGIN
ACCESSIBLE_MARGIN = 2
# A question is only worth the interruption when at least this many parts would
# change bucket depending on the answer.
QUESTION_MIN_BUCKET_MOVES = 3

# --- Propagation (local, not in 9.0) --------------------------------------------
# Below this an edge is not worth traversing; keeps the sweep inside its budget.
MIN_EDGE_CONTRIBUTION = 0.002

# Noisy-OR requires its incoming causes to be independent. A catalogue lists one
# physical component once per fitted position and variant, so nine `bumper_cover`
# rows in the front zone are one cause written nine times. Edges are therefore
# grouped into evidential channels — (source klass, relation) — and inside a
# channel the k-th strongest contribution counts for DECAY**k of itself.
# Distinct channels still combine at full strength, so the survival product
# between genuinely independent causes is untouched. See graph.propagate.
SOURCE_GROUP_DECAY = 0.35

# The direct (root) term says "the impact itself damaged this part". It is
# built from zone, depth and class prior — none of which know *what* was seen,
# only where and how hard. At full strength that made it the loudest term in
# the model, and the consequence was that the report barely depended on the
# damage at all: an un-seeded Yaris case, with no interpreter output
# whatsoever, produced six of the same eight order lines at the same
# probabilities. A hidden-damage prediction that survives deleting the evidence
# is not a prediction, it is a list of front-end parts.
#
# So the direct term is conditioned on there being observed damage to be direct
# *about*. It reaches full strength once the interpreter has seen something at
# this confidence and fades to nothing when it has seen nothing, leaving the
# leak and the edges — the terms that do depend on the evidence. Clamped rather
# than proportional so a confident observation reproduces the spec 9.3 numbers
# exactly.
ROOT_SUPPORT_FULL = 0.95

# --- Consumable tier (local) ------------------------------------------------
# Fasteners, retainers, liners and seals: destroyed because the component they
# hold is taken off, not because anyone chose to replace them. Their
# probabilities are right and stay as they are — what was wrong was showing
# them as order lines of their own. A repairer orders a bumper cover and its
# clips; they never order nine clips. buckets._group_hardware folds these
# under the part they belong to.
CONSUMABLE_KLASSES = frozenset({
    "clip",
    "cover_retainer",
    "seal",
    "fender_liner",
    "splash_shield",
    "undercover",
    "washer_nozzle",
    "mudflap",
})

# Relations along which a consumable belongs to the part above it.
PARENT_RELATIONS = ("hardware", "sub_assembly", "mounts")

# Hardware children listed under one order line. Beyond this the payload grows
# without telling the repairer anything new; the remainder is counted instead.
MAX_HARDWARE_CHILDREN = 6
