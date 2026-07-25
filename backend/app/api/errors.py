"""Exception -> the error envelope of spec 6.9."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# code -> (http status, retryable)
ERROR_CODES: dict[str, tuple[int, bool]] = {
    "rego_not_found": (404, False),
    "rego_not_allowed": (422, False),
    "vehicle_not_found": (404, False),
    "vehicle_not_ready": (409, True),
    "catalogue_unavailable": (200, False),
    "case_not_found": (404, False),
    "media_not_found": (404, False),
    "media_too_large": (413, False),
    "unsupported_media": (415, False),
    "transcription_failed": (502, True),
    "extraction_failed": (502, True),
    "prediction_unavailable": (409, True),
    "invalid_request": (422, False),
    "internal_error": (500, True),
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None,
                 retryable: bool | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        default_status, default_retryable = ERROR_CODES.get(code, (400, False))
        self.status = status if status is not None else default_status
        self.retryable = retryable if retryable is not None else default_retryable

    def envelope(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
            }
        }


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.envelope())

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        error = ApiError("invalid_request", "request failed validation")
        body = error.envelope()
        body["error"]["detail"] = exc.errors()[:5]
        return JSONResponse(status_code=error.status, content=body)
