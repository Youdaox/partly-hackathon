"""(klass_from, klass_to, relation) -> lambda.

Lambda is the probability that damage to the source part propagates to the
target across this relation, in the absence of any other evidence. It is the
per-edge strength in the noisy-OR of engines.graph.

Deliberately NOT stored on the edge rows in the database (spec 7.3): it resolves
at request time so new repair history changes predictions without a migration.

Relations:
  mounts    the target physically carries or is carried by the source
  hardware  the target is a fastener consumed by removing the source
  load_path the target is next in line for crash energy
  adjacent  the target is simply next to the source
  harness   the target is wiring or plumbing routed through the source
"""

EDGE_PRIOR: dict[tuple[str, str, str], float] = {
    # --- bumper cover comes off ---------------------------------------------
    ("bumper_cover", "cover_retainer", "hardware"): 0.90,   # 9.2 diagram
    ("bumper_cover", "clip", "hardware"): 0.85,
    ("bumper_cover", "grille", "mounts"): 0.62,
    ("bumper_cover", "bumper_absorber", "load_path"): 0.58,
    ("bumper_cover", "splash_shield", "mounts"): 0.55,
    ("bumper_cover", "fog_lamp", "mounts"): 0.48,
    ("bumper_cover", "moulding", "mounts"): 0.50,
    ("bumper_cover", "sensor", "mounts"): 0.35,
    ("bumper_cover", "headlamp", "adjacent"): 0.30,
    ("bumper_cover", "undercover", "adjacent"): 0.32,
    # --- grille and badging -------------------------------------------------
    ("grille", "emblem", "mounts"): 0.55,
    ("grille", "clip", "hardware"): 0.80,
    # --- absorber into the beam --------------------------------------------
    ("bumper_absorber", "reinforcement_beam", "load_path"): 0.52,
    ("reinforcement_beam", "crash_box", "load_path"): 0.55, # 9.2 diagram
    ("reinforcement_beam", "radiator_support", "adjacent"): 0.34,
    ("reinforcement_beam", "clip", "hardware"): 0.60,
    ("crash_box", "side_member", "load_path"): 0.30,
    ("side_member", "apron", "adjacent"): 0.34,
    ("side_member", "strut_tower", "load_path"): 0.22,
    ("side_member", "subframe", "load_path"): 0.20,
    ("subframe", "engine_mount", "mounts"): 0.28,
    ("apron", "washer_tank", "mounts"): 0.30,
    ("apron", "coolant_reservoir", "mounts"): 0.28,
    # --- headlamp -----------------------------------------------------------
    ("headlamp", "lamp_bracket", "mounts"): 0.70,          # 9.2 diagram
    ("headlamp", "radiator_support", "mounts"): 0.40,
    ("headlamp", "clip", "hardware"): 0.72,
    ("headlamp", "harness", "harness"): 0.30,
    ("headlamp", "fender", "adjacent"): 0.28,
    ("headlamp", "bonnet", "adjacent"): 0.22,
    ("fog_lamp", "lamp_bracket", "mounts"): 0.55,
    ("fog_lamp", "harness", "harness"): 0.25,
    # --- slam panel and cooling pack ---------------------------------------
    ("lamp_bracket", "radiator_support", "mounts"): 0.40,   # 9.2 diagram
    ("radiator_support", "radiator", "mounts"): 0.42,
    ("radiator_support", "horn", "mounts"): 0.34,
    ("radiator_support", "bonnet_latch", "mounts"): 0.38,
    ("radiator", "condenser", "adjacent"): 0.60,
    ("radiator", "cooling_fan", "mounts"): 0.48,
    ("radiator", "coolant_reservoir", "harness"): 0.26,
    ("condenser", "cooling_fan", "adjacent"): 0.35,
    # --- bonnet -------------------------------------------------------------
    ("bonnet", "bonnet_hinge", "mounts"): 0.38,
    ("bonnet", "bonnet_latch", "mounts"): 0.30,
    ("bonnet", "seal", "hardware"): 0.55,
    # --- guard --------------------------------------------------------------
    ("fender", "fender_liner", "mounts"): 0.64,
    ("fender", "clip", "hardware"): 0.75,
    ("fender", "mirror", "adjacent"): 0.20,
    ("fender", "door_panel", "adjacent"): 0.22,
    ("fender", "apron", "load_path"): 0.30,
    # --- wheel-first impacts ------------------------------------------------
    ("suspension_arm", "steering_knuckle", "mounts"): 0.45,
    ("steering_knuckle", "wheel_hub", "mounts"): 0.40,
    ("steering_knuckle", "drive_shaft", "load_path"): 0.30,
    ("steering_knuckle", "steering_rack", "load_path"): 0.28,
    ("wheel_hub", "brake_disc", "mounts"): 0.32,
    ("suspension_arm", "subframe", "mounts"): 0.25,
}

# Applied when two klasses co-occur on a diagram but no rule above covers them.
# Low on purpose: diagram adjacency is weak evidence on its own.
DEFAULT_ADJACENT_LAMBDA = 0.06

# Applied to a parent -> sub-assembly edge taken from `sub_assembly_ids`.
SUB_ASSEMBLY_LAMBDA = 0.45
