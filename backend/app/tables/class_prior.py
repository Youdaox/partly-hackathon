"""klass -> P(this part is replaced | damage reached its layer), plus its leak class.

`prior` is a ceiling on how strongly the class responds to damage at its depth:
a bumper cover that has been reached is almost always replaced, a firewall that
has been reached usually is not. `leak` is looked up in tables.constants.LEAK
and is the base rate that applies with no graph support at all.
"""

from app.tables.constants import LEAK

# klass -> (prior, leak_class)
CLASS_PRIOR: dict[str, tuple[float, str]] = {
    "bumper_cover": (0.95, "default"),
    "grille": (0.80, "default"),
    "emblem": (0.45, "consumable"),
    "moulding": (0.60, "consumable"),
    "mudflap": (0.50, "consumable"),
    "headlamp": (0.82, "default"),
    "tail_lamp": (0.80, "default"),
    "fog_lamp": (0.70, "default"),
    "bonnet": (0.72, "default"),
    "fender": (0.70, "default"),
    "door_panel": (0.62, "default"),
    "mirror": (0.55, "default"),
    "windscreen": (0.35, "default"),
    "cover_retainer": (0.90, "consumable"),
    "clip": (0.88, "consumable"),
    "bumper_absorber": (0.72, "default"),
    "splash_shield": (0.66, "consumable"),
    "undercover": (0.60, "consumable"),
    "fender_liner": (0.68, "consumable"),
    "seal": (0.55, "consumable"),
    "washer_nozzle": (0.30, "consumable"),
    "lamp_bracket": (0.68, "default"),
    "bracket": (0.45, "default"),
    "reinforcement_beam": (0.60, "structural"),
    "crash_box": (0.62, "structural"),
    "radiator_support": (0.55, "structural"),
    "bonnet_hinge": (0.35, "default"),
    "bonnet_latch": (0.35, "default"),
    "radiator": (0.55, "default"),
    "condenser": (0.55, "default"),
    "cooling_fan": (0.40, "default"),
    "coolant_reservoir": (0.30, "default"),
    "horn": (0.35, "default"),
    "washer_tank": (0.30, "default"),
    "sensor": (0.45, "default"),
    "side_member": (0.45, "structural"),
    "apron": (0.42, "structural"),
    "strut_tower": (0.30, "structural"),
    "suspension_arm": (0.40, "structural"),
    "steering_knuckle": (0.35, "structural"),
    "wheel_hub": (0.30, "structural"),
    "drive_shaft": (0.25, "structural"),
    "brake_disc": (0.20, "default"),
    "subframe": (0.30, "structural"),
    "engine_mount": (0.30, "structural"),
    "airbag_module": (0.50, "structural"),
    "harness": (0.35, "default"),
    "ecu": (0.20, "structural"),
    "firewall": (0.15, "structural"),
    "steering_rack": (0.25, "structural"),
    "unknown": (0.30, "default"),
}


def prior_for(klass: str) -> float:
    """Table lookup with a fallback. Kept trivial so tables/ stays data-only."""
    return CLASS_PRIOR.get(klass, CLASS_PRIOR["unknown"])[0]


def leak_for(klass: str) -> float:
    leak_class = CLASS_PRIOR.get(klass, CLASS_PRIOR["unknown"])[1]
    return LEAK[leak_class]


def leak_class_for(klass: str) -> str:
    return CLASS_PRIOR.get(klass, CLASS_PRIOR["unknown"])[1]
