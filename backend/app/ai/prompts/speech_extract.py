"""Structured extraction from a transcript (spec 8.3). One call, strict schema.

Never put free text into the model and never take free text out. The extraction
is a fixed shape so it can be validated and so a failure is a parse error rather
than a plausible-looking hallucination.

Hedging is preserved rather than flattened: repairers signal certainty naturally
and the counterfactual engine uses it to decide what to ask about next.
"""

SPEECH_EXTRACT_VERSION = "speech-extract-v1"

SPEECH_EXTRACT_PROMPT = """You are reading one spoken note from a panel repairer
standing in front of a damaged vehicle.

Extract only what they actually said. Do not infer damage they did not mention.

Preserve hedging exactly — it carries information:
  "the bumper's destroyed"            -> certainty high
  "the headlight's probably gone"     -> certainty medium
  "I think there might be suspension" -> certainty low
  "not sure about the rail"           -> certainty unsure

Negations matter and are scoped to their own clause. In "the bumper's off but
the wheel looks straight", the bumper is damaged and the wheel is explicitly
clear. Put explicitly-clear components in `components_clear`.

Respond with JSON only, exactly this shape:

{"zone": "front|rear|left|right|null",
 "side": "left|right|both|null",
 "components_mentioned": [
   {"raw": "bumper", "klass": "bumper_cover",
    "state": "damaged", "certainty": "high"}
 ],
 "components_clear": [{"raw": "wheel", "klass": "wheel_hub"}],
 "severity_cues": ["big impact", "wheel removed"],
 "questions_answered": {"wheels_straight": true}}
"""
