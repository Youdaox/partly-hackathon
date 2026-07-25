"""Media upload (spec 6.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import get_asr, get_vision
from app.api.errors import ApiError
from app.services import case_service, media_service
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

    if len(files) > media_service.MAX_FILES_PER_REQUEST:
        raise ApiError("media_too_large", "at most 10 files per request")

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
    return {"media_ids": [asset.id for asset in assets], "status": "processing"}
