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
    # 1 — the retainer is destroyed the moment the cover moves (spec 9.3 table)
    "cover_retainer": 1,
    # 2 — fasteners and shields immediately behind the skin
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
    "bonnet_hinge": 3,
    "bonnet_latch": 3,
    "harness": 3,
    # 4 — the collapse sequence behind the beam (spec 9.2 diagram)
    "crash_box": 4,
    "radiator_support": 4,
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
    "suspension_arm": 5,
    "steering_knuckle": 5,
    "wheel_hub": 5,
    "drive_shaft": 5,
    "brake_disc": 5,
    # 6 — deep structure and systems
    "strut_tower": 6,
    "subframe": 6,
    "engine_mount": 6,
    "airbag_module": 6,
    "ecu": 6,
    "firewall": 6,
    "steering_rack": 6,
}

# Parts the tagger could not place. Never gated out entirely, never promoted.
UNKNOWN_KLASS = "unknown"
UNKNOWN_DEPTH = 3
