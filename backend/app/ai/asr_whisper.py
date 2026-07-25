"""ASR provider.

`WhisperProvider` is the real implementation's shape; it is not wired up because
this build runs entirely offline against the shipped dataset. `StubASR` returns
a deterministic transcript so the speech path — upload, transcribe, extract,
observe, re-predict — is exercisable end to end without a model or a key.

Swapping in real Whisper means implementing `transcribe` and changing one line
in app.api.deps. Nothing in services/ changes.
"""

from __future__ import annotations

from app.ai import cache
from app.ai.base import Transcript

PROMPT_VERSION = "asr-v1"

# Cycled through for uploads we cannot actually transcribe, so a demo produces
# speech evidence that is plausible for a front-corner collision.
_CANNED = [
    "front right's taken a hit, bumper's off and the headlight's smashed",
    "wheel looks straight to me, no airbags went off",
    "there's a crack in the reinforcement bar behind the bumper",
]


class StubASR:
    """Deterministic: the same bytes always produce the same transcript."""

    name = "stub"

    async def transcribe(
        self, audio: bytes, mime: str, phrase_hints: list[str] | None = None
    ) -> Transcript:
        # Hints are part of the cache key: a transcript produced with a
        # vehicle's vocabulary is not the same result as one produced without it.
        key = cache.key_for(audio, f"{PROMPT_VERSION}:{len(phrase_hints or [])}")
        cached = cache.load("asr", key)
        if cached is not None:
            return Transcript(**cached)

        index = int(key[:8], 16) % len(_CANNED)
        transcript = Transcript(text=_CANNED[index], confidence=0.86, provider=self.name)
        cache.save("asr", key, {"text": transcript.text, "confidence": transcript.confidence,
                                "provider": transcript.provider})
        return transcript


class WhisperProvider:
    """Placeholder for the real provider. Not wired up in this build.

    `phrase_hints` is the interesting parameter: it carries the ~200 most likely
    part names for the resolved vehicle (see catalogue.vocabulary). Whisper takes
    these via `initial_prompt`; hosted ASRs generally take a speech-context or
    keyword-boost list.
    """

    name = "whisper"

    def __init__(self, model: str = "whisper-1"):
        self.model = model

    async def transcribe(
        self, audio: bytes, mime: str, phrase_hints: list[str] | None = None
    ) -> Transcript:
        raise NotImplementedError(
            "WhisperProvider is a stub: this build has no model credentials. "
            "Implement transcribe() and swap it in via app.api.deps."
        )
