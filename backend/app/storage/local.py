"""Filesystem storage for the MVP. Keys look like media/{case_id}/{name}."""

from __future__ import annotations

from pathlib import Path

from app.config import settings


class LocalStorage:
    def __init__(self, root: Path | None = None):
        self.root = Path(root or settings.storage_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        target = (self.root / key).resolve()
        # Keys come from request data, so refuse anything that escapes the root.
        if not str(target).startswith(str(self.root.resolve())):
            raise ValueError(f"invalid storage key: {key}")
        return target

    def put(self, key: str, data: bytes) -> str:
        target = self._resolve(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).is_file()

    def path(self, key: str) -> Path | None:
        return self._resolve(key)


storage = LocalStorage()
