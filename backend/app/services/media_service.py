"""Store, validate, extract frames, demux audio. Owns bytes, not meaning.

Frame extraction and audio demux shell out to ffmpeg when it is present. When it
is not, a video is still stored and still produces a case update — it just
contributes one keyframe (the file itself) rather than eight. Degrading rather
than failing matters here: a demo on a laptop without ffmpeg should still work.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

from app.storage.local import storage
from app.store import cases
from app.store.cases import Case, MediaAsset

# Spec 6.4 limits.
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_VIDEO_SECONDS = 120
MAX_FILES_PER_REQUEST = 10
MAX_KEYFRAMES = 8

IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
VIDEO_MIMES = {"video/mp4", "video/quicktime", "video/webm", "video/x-m4v"}
AUDIO_MIMES = {"audio/m4a", "audio/mp4", "audio/webm", "audio/mpeg", "audio/wav",
               "audio/x-m4a", "audio/ogg"}


class MediaError(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def validate(kind: str, mime: str, size: int) -> None:
    if kind == "image":
        if mime not in IMAGE_MIMES:
            raise MediaError("unsupported_media", f"{mime} is not a supported image", 415)
        if size > MAX_IMAGE_BYTES:
            raise MediaError("media_too_large", "images are limited to 12 MB", 413)
    elif kind == "video":
        if mime not in VIDEO_MIMES:
            raise MediaError("unsupported_media", f"{mime} is not a supported video", 415)
        if size > MAX_VIDEO_BYTES:
            raise MediaError("media_too_large", "videos are limited to 200 MB", 413)
    elif kind == "audio":
        if mime not in AUDIO_MIMES:
            raise MediaError("unsupported_media", f"{mime} is not a supported audio type", 415)
    else:
        raise MediaError("unsupported_media", f"unknown media kind {kind}", 415)


def store(case: Case, kind: str, filename: str, data: bytes, mime: str) -> MediaAsset:
    validate(kind, mime, len(data))
    # The storage key is namespaced and made safe; the asset keeps the name the
    # device sent, because that is the one the repairer will recognise.
    safe = Path(filename).name or "upload"
    key = f"media/{case.id}/{cases.new_id('f')}_{safe}"
    storage.put(key, data)
    return cases.add_media(
        case,
        kind=kind,
        storage_key=key,
        bytes=len(data),
        filename=safe,
        content_type=mime,
    )


def payload(asset: MediaAsset) -> dict:
    """One stored file as the client sees it (spec 6.4)."""
    return {
        "media_id": asset.id,
        "case_id": asset.case_id,
        "kind": asset.kind,
        "filename": asset.filename,
        "content_type": asset.content_type,
        "bytes": asset.bytes,
        "uploaded_at": asset.uploaded_at,
        "processed_at": asset.processed_at,
    }


async def keyframes(asset: MediaAsset, case: Case) -> list[bytes]:
    """Extract up to 8 keyframes at scene changes."""
    source = storage.path(asset.storage_key)
    if source is None or not source.is_file():
        return []
    if asset.kind == "image":
        return [source.read_bytes()]

    binary = _ffmpeg()
    if binary is None:
        # No ffmpeg: the video itself stands in as a single piece of evidence.
        return [source.read_bytes()]

    out_dir = source.parent / f"{asset.id}_frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "frame_%02d.jpg")
    command = [
        binary, "-y", "-loglevel", "error",
        "-i", str(source),
        "-vf", "select='gt(scene,0.3)',scale=1280:-1",
        "-vsync", "vfr", "-frames:v", str(MAX_KEYFRAMES),
        pattern,
    ]
    await _run(command)

    frames = sorted(out_dir.glob("frame_*.jpg"))[:MAX_KEYFRAMES]
    for frame in frames:
        key = f"media/{case.id}/frames/{asset.id}_{frame.name}"
        storage.put(key, frame.read_bytes())
        cases.add_media(case, kind="frame", storage_key=key, parent_id=asset.id,
                        bytes=frame.stat().st_size)
    return [frame.read_bytes() for frame in frames]


async def demux_audio(asset: MediaAsset, case: Case) -> bytes | None:
    """Pull the audio track out of a video so it can be transcribed too."""
    source = storage.path(asset.storage_key)
    binary = _ffmpeg()
    if source is None or binary is None or not source.is_file():
        return None

    target = source.parent / f"{asset.id}.m4a"
    command = [binary, "-y", "-loglevel", "error", "-i", str(source),
               "-vn", "-acodec", "aac", str(target)]
    await _run(command)
    if not target.is_file() or target.stat().st_size == 0:
        return None

    data = target.read_bytes()
    key = f"media/{case.id}/{asset.id}_audio.m4a"
    storage.put(key, data)
    cases.add_media(case, kind="audio", storage_key=key, parent_id=asset.id, bytes=len(data))
    return data


async def _run(command: list[str]) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        lambda: subprocess.run(command, capture_output=True, timeout=60, check=False),
    )
