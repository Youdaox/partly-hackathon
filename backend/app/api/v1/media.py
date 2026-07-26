"""Media upload (spec 6.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_asr, get_vision
from app.api.errors import ApiError
from app.services import case_service, media_service
from app.storage.local import storage
from app.store import cases

router = APIRouter(tags=["media"])


@router.post("/media/upload", status_code=202)
async def upload(
    case_id: str = Form(...),
    kind: str = Form(...),
    files: list[UploadFile] = File(...),
    vision=Depends(get_vision),
    asr=Depends(get_asr),
) -> dict:
    case = cases.get_case(case_id)
    if case is None:
        raise ApiError("case_not_found", f"no case {case_id}")

    limit = media_service.MAX_FILES_PER_REQUEST
    if limit is not None and len(files) > limit:
        raise ApiError("media_too_large", f"at most {limit} files per request")

    assets = []
    for upload_file in files:
        data = await upload_file.read()
        mime = upload_file.content_type or "application/octet-stream"
        try:
            assets.append(
                media_service.store(case, kind, upload_file.filename or "upload", data, mime)
            )
        except media_service.MediaError as error:
            raise ApiError(error.code, error.message, error.status) from error

    case_service.dispatch_media(case, assets, vision, asr)
    return {
        "media_ids": [asset.id for asset in assets],
        # The same assets in full, so the client can render what was just added
        # without a second round trip. `media_ids` stays for existing callers.
        "media": [media_service.payload(asset) for asset in assets],
        "status": "processing",
    }


@router.get("/media/{media_id}")
async def media_bytes(media_id: str) -> Response:
    """The stored file itself, for rendering a thumbnail of what was uploaded.

    Served from the case store rather than from a guessable path: the media_id
    is the only handle, so a file cannot be fished out by constructing a
    filename. Immutable — an asset is written once and never rewritten.
    """
    asset = cases.get_media(media_id)
    if asset is None:
        raise ApiError("media_not_found", f"no media {media_id}")

    path = storage.path(asset.storage_key)
    if path is None or not path.is_file():
        raise ApiError("media_not_found", f"media {media_id} is no longer stored")

    return FileResponse(
        path,
        media_type=asset.content_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/case/{case_id}/media")
async def list_media(case_id: str) -> dict:
    """Every file uploaded to this case, oldest first.

    Uploads are recorded and listed, never analysed: the prediction is driven
    by the shipped Interpreter output for the vehicle, and a photo does not
    change it. This endpoint answers "which images did I send", nothing more.
    """
    case = cases.get_case(case_id)
    if case is None:
        raise ApiError("case_not_found", f"no case {case_id}")
    return {
        "case_id": case.id,
        "media": [media_service.payload(asset) for asset in cases.uploaded_media(case)],
    }
