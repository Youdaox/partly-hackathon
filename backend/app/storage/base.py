"""Storage is bytes addressed by key. It owns no metadata (spec 4.1)."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class StorageBackend(Protocol):
    def put(self, key: str, data: bytes) -> str: ...

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def path(self, key: str) -> Path | None:
        """Local path when one exists, for handing to ffmpeg and friends."""
        ...
