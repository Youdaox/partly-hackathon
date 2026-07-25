"""Versioned prompt templates.

Versions are part of the model cache key (spec 4.3): changing a prompt changes
the hash, so old cached responses are never served against a new prompt.
"""

from app.ai.prompts.speech_extract import SPEECH_EXTRACT_PROMPT, SPEECH_EXTRACT_VERSION
from app.ai.prompts.vision import VISION_PROMPT, VISION_VERSION

__all__ = [
    "VISION_PROMPT",
    "VISION_VERSION",
    "SPEECH_EXTRACT_PROMPT",
    "SPEECH_EXTRACT_VERSION",
]
