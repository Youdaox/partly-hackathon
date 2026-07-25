"""Ordered match rules: display name -> klass. First match wins.

Order is the whole design. "Front Bumper Cover Retainer - Right Upper" must hit
`cover_retainer` before `bumper_cover`, and "Radiator Support Headlamp Bracket -
Right" must hit `lamp_bracket` before either `radiator_support` or `headlamp`.
So the most specific patterns are listed first and the generic nouns last.

Patterns are matched case-insensitively against the lowercased display name with
the standard note appended. Names in this dataset are AU/NZ English: bonnet not
hood, guard as well as fender, calliper not caliper.
"""

# (pattern, klass) — evaluated top to bottom.
KLASS_RULES: list[tuple[str, str]] = [
    # --- fasteners and retainers: must precede the panel they attach to ------
    (r"cover retainer|bumper retainer|retainer", "cover_retainer"),
    (r"\bclip\b|grommet|pin hold|rivet|\bclamp\b", "clip"),
    (r"\bbolt\b|\bnut\b|\bscrew\b|\bstud\b|washer for|hardware part", "clip"),
    # --- brackets: must precede the component they carry --------------------
    (r"headlamp bracket|head lamp bracket|lamp bracket", "lamp_bracket"),
    (r"bumper (side )?stay|bumper arm|bumper extension", "crash_box"),
    (r"bumper (side )?bracket", "bracket"),
    # --- bumper system ------------------------------------------------------
    (r"impact absorber|energy absorber|bumper absorber", "bumper_absorber"),
    (r"bumper reinforcement|reinforcement bar|bumper beam", "reinforcement_beam"),
    (r"crash box|bumper crush|extension sub-assembly", "crash_box"),
    (r"splash shield|bumper shield", "splash_shield"),
    (r"bumper cover|bumper assembly|bumper insert|bumper garnish", "bumper_cover"),
    # --- grille, badging, trim ---------------------------------------------
    (r"grille", "grille"),
    (r"emblem|name plate|badge", "emblem"),
    (r"moulding|molding|garnish|protector|\bstrip\b", "moulding"),
    (r"mudguard|mud flap|mudflap", "mudflap"),
    # --- lighting -----------------------------------------------------------
    (r"fog lamp|fog light|driving lamp", "fog_lamp"),
    (r"head ?lamp|head ?light", "headlamp"),
    (r"tail ?lamp|tail ?light|rear combination lamp|stop lamp", "tail_lamp"),
    # --- cooling pack -------------------------------------------------------
    (r"condenser", "condenser"),
    (r"cooling fan|fan motor|fan shroud", "cooling_fan"),
    (r"coolant reservoir|reserve tank|expansion tank", "coolant_reservoir"),
    (r"radiator support|slam panel|lower radiator support", "radiator_support"),
    (r"radiator", "radiator"),
    # --- bonnet -------------------------------------------------------------
    (r"bonnet hinge|hood hinge", "bonnet_hinge"),
    (r"bonnet latch|hood latch|bonnet lock|hood lock|bonnet release", "bonnet_latch"),
    (r"bonnet|hood panel|\bhood\b", "bonnet"),
    # --- outer panels -------------------------------------------------------
    (r"fender liner|guard liner|wheel arch liner|wheelhouse liner", "fender_liner"),
    (r"fender|front guard|quarter panel", "fender"),
    (r"under ?cover|under ?shield|engine under", "undercover"),
    (r"door panel|door shell|door outer", "door_panel"),
    (r"mirror", "mirror"),
    (r"windscreen|windshield|window glass", "windscreen"),
    # --- washers and small ancillaries -------------------------------------
    (r"washer nozzle|washer jet", "washer_nozzle"),
    (r"washer tank|washer bottle|washer reservoir", "washer_tank"),
    (r"\bhorn\b", "horn"),
    (r"sensor|camera|radar", "sensor"),
    # --- structure ----------------------------------------------------------
    (r"side member|frame side rail|chassis rail", "side_member"),
    (r"apron|inner guard|wheelhouse", "apron"),
    (r"strut tower|suspension tower|shock tower", "strut_tower"),
    (r"suspension (control )?arm|lower arm|upper arm|control arm", "suspension_arm"),
    (r"steering knuckle|hub carrier|upright", "steering_knuckle"),
    (r"steering rack|steering gear|tie rod", "steering_rack"),
    (r"axle hub|wheel hub|hub bearing", "wheel_hub"),
    (r"drive shaft|drive axle|cv joint|half shaft", "drive_shaft"),
    (r"brake disc|brake rotor|calliper|caliper", "brake_disc"),
    (r"subframe|sub frame|crossmember|cross member", "subframe"),
    (r"engine mount|engine mounting|transmission mount", "engine_mount"),
    (r"airbag|air bag|seat belt pretensioner", "airbag_module"),
    (r"wire harness|wiring harness|harness", "harness"),
    (r"\becu\b|control module|computer assembly", "ecu"),
    (r"firewall|dash panel|cowl panel|cowl", "firewall"),
    # --- catch-alls: last on purpose ---------------------------------------
    (r"\bseal\b|weatherstrip|gasket", "seal"),
    (r"reinforcement", "reinforcement_beam"),
    # Generic bracket: deliberately its own klass, not lamp_bracket. Absorbing
    # every unqualified "... Bracket" into the headlamp mount would put hundreds
    # of unrelated parts on a load path they have nothing to do with.
    (r"bracket|\bstay\b", "bracket"),
]

# --- Side detection ---------------------------------------------------------
# "Right Front Axle Hub" and "Bonnet Hinge - Right" both need to resolve to R.
SIDE_RULES: list[tuple[str, str]] = [
    (r"\bright\b|\brh\b|\br/h\b", "R"),
    (r"\bleft\b|\blh\b|\bl/h\b", "L"),
]

# --- Zone detection ---------------------------------------------------------
# Checked in order; a name mentioning both front and rear (rare) takes the first.
ZONE_RULES: list[tuple[str, str]] = [
    # "Front Door Trim Moulding" is not in the front crash zone. This catalogue
    # uses "front" for the front *door* as well as the front of the car, and
    # without this rule a front bumper impact implicates the interior door trim
    # and the door airbag sensors. Must be checked before the front rule.
    (
        r"\bdoor\b|\bsill\b|\broof\b|\bseat\b|console|dashboard|instrument panel"
        r"|glove|armrest|headlining|\bpillar\b|\bcabin\b",
        "other",
    ),
    (r"\bfront\b|\bbonnet\b|\bhood\b|radiator|headlamp|head lamp|fog lamp", "front"),
    (r"\brear\b|\bboot\b|\btrunk\b|tailgate|tail lamp|tail light", "rear"),
]

# Klasses that sit on the vehicle centre-line, so a left/right impact reaches
# them equally. Prevents the side gate from wrongly suppressing them.
CENTRELINE_KLASSES: frozenset[str] = frozenset(
    {
        "bumper_cover",
        "grille",
        "emblem",
        "reinforcement_beam",
        "radiator_support",
        "radiator",
        "condenser",
        "cooling_fan",
        "bonnet",
        "windscreen",
        "firewall",
        "subframe",
        "coolant_reservoir",
        "steering_rack",
    }
)
