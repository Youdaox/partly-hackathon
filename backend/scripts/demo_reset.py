"""Reset to a clean demo state: drop all cases, vehicles and stored media.

Leaves the catalogue cache alone — reloading it costs ~1 s and nothing about a
demo requires it.

Usage:  python -m scripts.demo_reset
"""

from __future__ import annotations

import shutil
import sys

from app.config import settings
from app.store import cases


def main() -> int:
    before = cases.stats()
    cases.reset()

    storage = settings.storage_dir
    if storage.is_dir():
        shutil.rmtree(storage)
        storage.mkdir(parents=True, exist_ok=True)

    print(f"cleared {before['cases']} cases, {before['vehicles']} vehicles")
    print(f"cleared media under {storage}")
    print("catalogue cache left warm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
