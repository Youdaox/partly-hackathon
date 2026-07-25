"""Audio transcription (spec 6.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import get_asr
from app.api.errors import ApiError
from app.services import case_service, media_service
from app.store import cases

router = APIRouter(tags=["audio"])


@router.post("/audio/transcribe", status_code=202)
async def transcribe(
    case_id: str = Form(...),
    file: UploadFile = File(...),
    asr=Depends(get_asr),
) -> dict:
    case = cases.get_case(case_id)
    if case is None:
        raise ApiError("case_not_found", f"no case {case_id}")

    data = await file.read()
    mime = file.content_type or "audio/m4a"
    try:
        media_service.store(case, "audio", file.filename or "clip.m4a", data, mime)
    except media_service.MediaError as error:
        raise ApiError(error.code, error.message, error.status) from error

    message_id = case_service.dispatch_audio(case, data, mime, asr)
    return {"message_id": message_id, "status": "transcribing"}
