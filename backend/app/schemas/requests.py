"""Wire format only. Never used internally between services (spec 5.1)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RegisterVehicleRequest(BaseModel):
    rego: str = Field(min_length=1, max_length=16)


class CreateCaseRequest(BaseModel):
    vehicle_id: str


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AnswerRequest(BaseModel):
    question_id: str
    value: str


class AnalyseRequest(BaseModel):
    case_id: str


class PredictionRunRequest(BaseModel):
    case_id: str


class ConfirmRequest(BaseModel):
    case_id: str
    part_id: str
    damaged: bool


class OrderLineRequest(BaseModel):
    part_id: str
    offer_id: str | None = None
    qty: int = 1
    action: str = Field(default="accept", pattern="^(accept|reject|modify)$")


class FinaliseRequest(BaseModel):
    case_id: str
    lines: list[OrderLineRequest]
