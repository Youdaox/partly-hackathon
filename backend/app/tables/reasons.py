"""klass -> the one line a repairer reads next to the part.

Written to be read out loud in a workshop, not to be defensible in a report.
Short, concrete, and about *this* part's relationship to the damage.
"""

REASONS: dict[str, str] = {
    "cover_retainer": "snaps when the cover comes off",
    "clip": "single-use once it has been prised out",
    "bumper_absorber": "sits directly behind the cover and crushes by design",
    "reinforcement_beam": "took the load once the cover and absorber gave way",
    "crash_box": "designed to fold before the rail does",
    "splash_shield": "tears out with the bumper it is stapled to",
    "lamp_bracket": "behind the lamp you've already lost",
    "bracket": "carries something in the impact zone",
    "headlamp": "in the impact zone and rarely survives it",
    "fog_lamp": "low in the corner that took the hit",
    "grille": "clipped to the cover that came off",
    "emblem": "mounted to the grille, usually breaks with it",
    "moulding": "bonded to the panel underneath",
    "bumper_cover": "the outer skin at the point of impact",
    "fender": "adjacent panel in the impact corner",
    "fender_liner": "torn when the guard moved",
    "bonnet": "leading edge is in the impact path",
    "bonnet_hinge": "bent if the bonnet was pushed back",
    "bonnet_latch": "misaligned once the slam panel moves",
    "radiator_support": "carries the lamp and the cooling pack",
    "radiator": "first thing behind the beam",
    "condenser": "sits ahead of the radiator, so it goes first",
    "cooling_fan": "shrouded to the radiator that moved",
    "coolant_reservoir": "mounted in the corner behind the guard",
    "washer_tank": "lives in the guard cavity on this side",
    "washer_nozzle": "fed by the line you'll disturb anyway",
    "horn": "bolted to the slam panel in the impact corner",
    "sensor": "aimed through the bumper and needs recalibration",
    "side_member": "the load path once the crash box is used up",
    "apron": "buckles when the rail takes the hit",
    "strut_tower": "only moves in a heavy corner impact",
    "suspension_arm": "check if the wheel is not sitting square",
    "steering_knuckle": "bent alongside the arm in a wheel-first hit",
    "wheel_hub": "worth checking after a wheel-first impact",
    "drive_shaft": "plunges when the wheel is pushed back",
    "brake_disc": "scored if the caliper shifted",
    "subframe": "the last thing to move, and the most expensive",
    "engine_mount": "sheared if the engine has shifted",
    "airbag_module": "consumed if it deployed",
    "harness": "routed through the crush zone",
    "ecu": "mounted low in the impact corner",
    "firewall": "only involved in a severe intrusion",
    "seal": "not reusable once the panel is off",
    "undercover": "unclipped and usually cracked",
    "mudflap": "in the corner and cheap to replace while you are there",
    "door_panel": "adjacent to the impact and may be sprung",
    "mirror": "on the corner that was struck",
    "windscreen": "check for cracks if the shell has flexed",
    "tail_lamp": "in the impact zone at the rear",
    "steering_rack": "check alignment after a wheel-first hit",
    "unknown": "in the impact zone",
}

# Shown when the graph has nothing better to say.
DEFAULT_REASON = "in the impact zone"

# Attribution label for the base rate term in engines.graph.
LEAK_CAUSE = "base rate"
