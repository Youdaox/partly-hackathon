"""Disk cache for every outbound model call, keyed by sha256(input + prompt
version) (spec 4.3).

Written on first use, read thereafter, so the service runs fully offline once
warm and a demo never depends on a network round trip.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.config import settings


def key_for(payload: bytes, prompt_version: str) -> str:
    digest = hashlib.sha256()
    digest.update(payload)
    digest.update(prompt_version.encode())
    return digest.hexdigest()


def _path(namespace: str, key: str) -> Path:
    return Path(settings.cache_dir) / namespace / f"{key}.json"


def load(namespace: str, key: str) -> Any | None:
    path = _path(namespace, key)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def save(namespace: str, key: str, value: Any) -> None:
    path = _path(namespace, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def entries() -> int:
    root = Path(settings.cache_dir)
    if not root.is_dir():
        return 0
    return sum(1 for _ in root.rglob("*.json"))
