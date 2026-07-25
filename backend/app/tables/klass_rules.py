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
    # A seal or gasket is consumed by the panel coming off, exactly like a
    # retainer, so it belongs in this block rather than in the catch-alls it
    # used to sit in. Down there the assembly nouns reached it first and a lamp
    # gasket came back as klass `headlamp` — which made it a `mounts` source,
    # and the report explained a bracket with "bolted to Left Headlamp Lens
    # Gasket".
    (r"\bseal\b|weatherstrip|gasket", "seal"),
    # --- brackets: must precede the component they carry --------------------
    (r"headlamp bracket|head lamp bracket|lamp bracket", "lamp_bracket"),
    (r"bumper (side )?stay|bumper arm|bumper extension", "crash_box"),
    (r"bumper (side )?bracket", "bracket"),
    # A lamp's wire is not the lamp: "Right Headlight Wiring Harness" must not
    # fall into `headlamp` just because "headlight" is a substring. Must
    # precede the lighting block below. Scoped to wire/wiring so it doesn't
    # pre-empt the retainer/clip rules above it for names like "...Harness Clip".
    (r"wire harness|wiring harness", "harness"),
    # --- bumper system ------------------------------------------------------
    (r"impact absorber|energy absorber|bumper absorber", "bumper_absorber"),
    # A reinforcement "brace" is the bracket sub-assembly that carries the beam's
    # load into the side member — structurally the crash box, not the beam
    # itself (std_note on this catalogue's part: "BRACKET SUB-ASSY, FRONT SIDE
    # MEMBER"). Must precede the plain "bumper reinforcement" rule below, which
    # "Front Bumper Reinforcement Brace" would otherwise match first. Scoped to
    # the bumper: an unrelated "Quarter Panel Reinforcement Brace" exists in
    # this catalogue with no evidence it plays the same role. Excludes
    # "...Brace Protector", a separate cover part this rule has no evidence for.
    (r"bumper reinforcement brace(?!\s*protector)", "crash_box"),
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
    # A lamp's relay is not the lamp, the same way its harness is not. Left in
    # `fog_lamp` it became a `mounts` source, so the report explained a headlamp
    # bracket with "Left Fog Lamp Relay" — a relay holding up a bracket.
    (r"\brelay\b|fuse ?box|junction block", "harness"),
    # Nor is a lamp's bulb the lamp. EDGE_PRIOR fires (headlamp -> lamp_bracket,
    # mounts) at λ 0.70, so with a bulb classed as `headlamp` the report
    # explained a bracket with "bolted to Left Headlight Bulb (Single)". Bulbs
    # still travel with the lamp — they hang off it by `sub_assembly`, which is
    # what nests them in the report — they just stop being something a bracket
    # can be bolted to.
    (r"\bbulb\b|\bglobe\b|bulb socket|terminal boot", "harness"),
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
    # Two specific components that must beat the generic panel noun below.
    # `classify` matches against the name *and* the OEM std_note, and this
    # catalogue files parts under the assembly they belong to rather than what
    # they are: "Right Front Strut Tower" carries the note "APRON SUB-ASSY,
    # FRONT FENDER, REAR RH", so with `fender` first a suspension tower came
    # back as a depth-1 body panel, priced and reasoned about as one. The seal
    # rule has the mirror problem — the name says "Front Guard ... Seal" and
    # only the note ("SEAL, FRONT FENDER TO COWL SIDE") says what it is. Both
    # sit here for the reason in this file's docstring: specific before generic.
    (r"strut tower|suspension tower|shock tower", "strut_tower"),
    (r"apron|inner guard|wheelhouse", "apron"),
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
    # "Headlight" and "headlamp" are used interchangeably in this catalogue —
    # 43 Yaris parts (relays, sensors, the wiring harness) say "headlight" and
    # none of them matched here before this line included it. A part with
    # zone="other" gets zone_factor 0 and candidate_set drops it unconditionally
    # (physics.py), so this was not a scoring error — those parts could never
    # appear in a report at all, at any severity.
    # A rear fog lamp is at the rear. The front rule below claims every
    # "fog lamp" outright — which is what put "Left Rear Fog Lamp Assembly" in
    # the Santa Fe's front-impact order list. Matched as whole phrases rather
    # than by moving `\brear\b` above the front rule, because plenty of genuine
    # front parts carry a positional "- Rear" suffix ("Right Front Guard Liner
    # Insulator - Rear") and would be thrown out of the front zone with it.
    (r"rear fog\s?lamp|rear fog\s?light|rear combination lamp", "rear"),
    (r"\bfront\b|\bbonnet\b|\bhood\b|radiator|head\s?lamp|head\s?light|fog\s?lamp|fog\s?light", "front"),
    (r"\brear\b|\bboot\b|\btrunk\b|tailgate|tail\s?lamp|tail\s?light", "rear"),
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
