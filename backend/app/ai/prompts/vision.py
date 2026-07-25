"""Vision prompt (spec 8.2). Strict JSON out, never free text.

The severity ladder definitions live *in the prompt*. A model asked "how severe,
1-5?" returns noise; asked "which of these five descriptions matches what you can
see?" it is reliable, because every rung names observable consequences rather
than a feeling about magnitude.
"""

VISION_VERSION = "vision-v1"

# Each rung is written as things you can see, not as an adjective.
SEVERITY_LADDER = {
    1: "Cosmetic only. Paint scuffs, scratches or light marks. No panel is "
       "deformed, nothing is detached, every gap and shut line looks even.",
    2: "One outer panel or lamp is dented, cracked or broken, but everything is "
       "still attached and in roughly its correct position.",
    3: "Outer skin has failed. A bumper cover, lamp or panel is detached, "
       "hanging or missing, and structure behind it is visible. No sign the "
       "vehicle's frame has moved.",
    4: "Damage is past the outer skin. The reinforcement beam, slam panel or "
       "cooling pack is deformed or displaced, shut lines are uneven, or a "
       "wheel is visibly pushed out of position.",
    5: "Structural. Rails, subframe or cabin are deformed, airbags have "
       "deployed, or the vehicle is obviously beyond economic repair.",
}

_LADDER_TEXT = "\n".join(f"  {rank}. {text}" for rank, text in sorted(SEVERITY_LADDER.items()))

VISION_PROMPT = f"""You are assessing collision damage from still frames of one vehicle.

Report only what is visible in these frames. Do not infer hidden damage — that is
done downstream from your output. If frames disagree with each other, say so in
`frame_conflicts` rather than silently picking one.

SEVERITY LADDER — choose the rung whose description matches what you can see:
{_LADDER_TEXT}

Two specific checks, because they change the assessment more than anything else:
  wheel_displaced   Is any wheel pushed back, tilted, or out of line with its arch?
  airbag_deployed   Are any airbags visibly deployed through the cabin?

For each visible component use `state` from: destroyed, detached, cracked,
dented, scuffed, intact. Use `certainty` from: high, low.

Respond with JSON only, exactly this shape:

{{"zone": "front|rear|left|right",
  "side": "left|right|both|centre",
  "severity": 1,
  "severity_evidence": ["short observable facts that justify the rung"],
  "wheel_displaced": false,
  "airbag_deployed": false,
  "visible_components": [
    {{"raw": "front bumper cover", "klass": "bumper_cover",
      "state": "destroyed", "certainty": "high"}}
  ],
  "frame_conflicts": ["frame_01 reports right, frame_05 reports left"]}}
"""
