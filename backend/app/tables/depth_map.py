"""klass -> depth on a 0..6 scale.

0 is the outermost surface a repairer sees without touching anything; 6 is
structure you only reach after substantial teardown. Depth drives two things:
the severity gate in engines.physics, and the accessibility test in
engines.counterfactual.
"""

DEPTH_MAP: dict[str, int] = {
    # 0 — outer skin, visible from the kerb
    "bumper_cover": 0,
    "grille": 0,
    "emblem": 0,
    "moulding": 0,
    "mudflap": 0,
    # 1 — bolt-on outer panels and lighting
    "headlamp": 1,
    "tail_lamp": 1,
    "fog_lamp": 1,
    "bonnet": 1,
    "fender": 1,
    "door_panel": 1,
    "mirror": 1,
    "windscreen": 1,
    # 2 — fasteners and shields immediately behind the skin
    "cover_retainer": 2,
    "clip": 2,
    "bumper_absorber": 2,
    "splash_shield": 2,
    "undercover": 2,
    "fender_liner": 2,
    "seal": 2,
    "washer_nozzle": 2,
    # 3 — brackets, beams, the slam panel
    "lamp_bracket": 3,
    "bracket": 3,
    "reinforcement_beam": 3,
    "crash_box": 3,
    "radiator_support": 3,
    "bonnet_hinge": 3,
    "bonnet_latch": 3,
    # 4 — cooling pack and ancillaries behind the beam
    "radiator": 4,
    "condenser": 4,
    "cooling_fan": 4,
    "coolant_reservoir": 4,
    "horn": 4,
    "washer_tank": 4,
    "sensor": 4,
    # 5 — rails, suspension, hubs
    "side_member": 5,
    "apron": 5,
    "strut_tower": 5,
    "suspension_arm": 5,
    "steering_knuckle": 5,
    "wheel_hub": 5,
    "drive_shaft": 5,
    "brake_disc": 5,
    # 6 — deep structure and systems
    "subframe": 6,
    "engine_mount": 6,
    "airbag_module": 6,
    "harness": 6,
    "ecu": 6,
    "firewall": 6,
    "steering_rack": 6,
}

# Parts the tagger could not place. Never gated out entirely, never promoted.
UNKNOWN_KLASS = "unknown"
UNKNOWN_DEPTH = 3
