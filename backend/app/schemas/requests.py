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


class TranscriptEditRequest(BaseModel):
    """Spec 8.4: a wrong transcript is editable, and edits re-run extraction."""

    text: str = Field(min_length=1, max_length=2000)


class AnalyseRequest(BaseModel):
    case_id: str


class PredictionRunRequest(BaseModel):
    case_id: str


class ConfirmRequest(BaseModel):
    case_id: str
    part_id: str
    # null clears a prior tick/cross and returns the part to whatever the model's
    # own probability says — "back to AI-suggested" rather than settled either way.
    damaged: bool | None


class OrderLineRequest(BaseModel):
    part_id: str
    offer_id: str | None = None
    qty: int = 1
    action: str = Field(default="accept", pattern="^(accept|reject|modify)$")


class FinaliseRequest(BaseModel):
    case_id: str
    lines: list[OrderLineRequest]


class ApprovalPick(BaseModel):
    """One per-part decision: a chosen offer, or an explicit leave-it-out."""

    part_id: str
    offer_id: str | None = None
    action: str = Field(default="accept", pattern="^(accept|reject)$")


class SubmitApprovalRequest(BaseModel):
    """The customer approving the quote.

    Two shapes, because the two approval UIs ask differently:
      option_id  one supply tier applied to the whole quote
      lines      a pick per part (the richer per-part form)
    Exactly one must be present.
    """

    option_id: str | None = None
    lines: list[ApprovalPick] | None = None
