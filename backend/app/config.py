"""Settings from env. Defaults assume the repo layout, so nothing needs configuring
to run the demo."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PARTLI_", env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    storage_dir: Path = REPO_ROOT / "backend" / ".storage"
    cache_dir: Path = REPO_ROOT / "backend" / ".cache"

    # Case TTL for the in-memory store (spec 7.4).
    case_ttl_hours: int = 24

    # Preload every catalogue at boot so nothing lazy-loads on the hot path (spec 4.5).
    preload_catalogues: bool = True

    engine_version: str = "graph-1.0.0"

    # Where the approval page is served from. Must be reachable from the
    # customer's phone, not just from this machine.
    #
    # Left empty on purpose: the approval URL is then built from the host the request
    # arrived on, so a phone that reached the backend at 10.20.0.63:8080 gets a link to
    # 10.20.0.63:3000 rather than to localhost, which on a phone means the phone itself.
    # Set PARTLI_WEB_BASE_URL to override (a tunnel, a deployed URL).
    web_base_url: str = ""

    # Port the Next app listens on, used when deriving the approval URL.
    web_port: int = 3000

    @property
    def vehicles_dir(self) -> Path:
        return self.data_dir / "vehicles"

    @property
    def predictions_dir(self) -> Path:
        return self.data_dir / "predictions"

    @property
    def history_csv(self) -> Path:
        return self.data_dir / "history" / "cooccurrence.csv"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
