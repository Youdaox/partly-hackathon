"""Case lifecycle, background task dispatch, and the repredict trigger.

The important property here is principle (1): every task writes its observations
and then calls `repredict`, with no coordination between them. Whoever finishes
last produces the most complete answer and every intermediate answer is valid,
which is why there is no broker and no task ordering (spec 4.4).

`repredict` recomputes from scratch every time rather than patching. The engine
is pure and takes ~20 ms, so a full recompute is cheaper than the bookkeeping
that incremental updates would need — and it means a confirmation, a transcript
and a photo all take exactly the same code path.
"""

from __future__ import annotations

import asyncio

from app.ai.base import ASRProvider, VisionProvider
from app.catalogue import registry, vocabulary
from app.engines import orchestrator
from app.engines.history import EMPTY_HISTORY
from app.services import (
    evidence_service,
    media_service,
    report_service,
    speech_service,
    vehicle_service,
    vision_service,
)
from app.store import cases
from app.store.cases import Case, MediaAsset
from app.utils import sse


def create(vehicle_id: str) -> Case:
    return cases.create_case(vehicle_id)


def _catalogue(case: Case):
    vehicle = cases.get_vehicle(case.vehicle_id)
    if vehicle is None or not vehicle.slug:
        return None, vehicle
    return registry.get(vehicle.slug), vehicle


def repredict(case_id: str, rank_inspections: bool = True) -> dict | None:
    """Recompute the whole report and push it. Safe to call from anywhere."""
    case = cases.get_case(case_id)
    if case is None:
        return None

    catalogue, vehicle = _catalogue(case)
    if vehicle is None:
        return None

    report = None
    if catalogue is not None:
        evidence = evidence_service.merge(case, catalogue)
        report = orchestrator.run(
            catalogue.parts,
            catalogue.edges,
            evidence,
            EMPTY_HISTORY,
            conflicts=case.conflicts,
            asked=frozenset(case.questions_asked),
            rank_inspections=rank_inspections,
        )

    if case.status in ("open", "analysing"):
        case.status = "ready" if report is not None else case.status

    payload = report_service.build(case, vehicle, catalogue, report)
    case.last_report = payload
    cases.touch(case)

    sse.publish(case.id, "report", payload)
    if payload.get("question"):
        sse.publish(case.id, "question", payload["question"])
    return payload


def confirm(case_id: str, part_id: str, damaged: bool | None) -> dict | None:
    """The tick/cross loop. Budgeted at 150 ms, so no counterfactual re-ranking.

    Re-runs propagation with the *full* clamp set, never just the newest one
    (spec 7.4) — that falls out of recomputing from the case's confirmations
    dict rather than mutating the previous report. `damaged=None` clears a
    prior tick/cross instead of setting one, returning the part to the AI's
    own bucket.
    """
    case = cases.get_case(case_id)
    if case is None:
        return None
    cases.set_confirmation(case, part_id, damaged)

    # Confirming a part proves teardown has reached its layer — but clearing one
    # is undoing a mistake, not new evidence, so it must not advance teardown.
    if damaged is not None:
        catalogue, _ = _catalogue(case)
        if catalogue is not None:
            part = catalogue.by_id.get(part_id)
            if part is not None:
                case.exposed_depth = max(case.exposed_depth, part.depth)

    return repredict(case_id, rank_inspections=False)


# --- Background work --------------------------------------------------------

def dispatch_media(case: Case, assets: list[MediaAsset], provider: VisionProvider,
                   asr: ASRProvider) -> None:
    case.status = "analysing"
    for asset in assets:
        case.analysing.add(asset.id)
    asyncio.create_task(_media_task(case, assets, provider, asr))


async def _media_task(case: Case, assets: list[MediaAsset], provider: VisionProvider,
                      asr: ASRProvider) -> None:
    _, vehicle = _catalogue(case)
    slug = vehicle.slug if vehicle else None

    frames: list[bytes] = []
    for index, asset in enumerate(assets, start=1):
        sse.publish(case.id, "analysis",
                    {"stage": "frames", "progress": round(index / (len(assets) + 1), 2)})
        try:
            frames.extend(await media_service.keyframes(asset, case))
            if asset.kind == "video":
                audio = await media_service.demux_audio(asset, case)
                if audio:
                    await _transcribe(case, audio, "audio/m4a", asr)
        except Exception:  # noqa: BLE001 - one bad file must not kill the case
            sse.publish(case.id, "analysis", {"stage": "frames", "error": asset.id})
        finally:
            case.analysing.discard(asset.id)

    sse.publish(case.id, "analysis", {"stage": "vision", "progress": 0.6})
    try:
        result = await vision_service.analyse(provider, case, slug, frames)
        vision_service.apply(case, result)
    except Exception:  # noqa: BLE001
        sse.publish(case.id, "analysis", {"stage": "vision", "error": "extraction_failed"})

    sse.publish(case.id, "analysis", {"stage": "vision", "progress": 1.0})
    repredict(case.id)


def dispatch_audio(case: Case, audio: bytes, mime: str, asr: ASRProvider) -> str:
    message = cases.add_message(case, role="repairer", kind="voice")
    asyncio.create_task(_audio_task(case, audio, mime, asr, message.id))
    return message.id


async def _audio_task(case: Case, audio: bytes, mime: str, asr: ASRProvider,
                      message_id: str) -> None:
    await _transcribe(case, audio, mime, asr, message_id)
    repredict(case.id)


async def _transcribe(case: Case, audio: bytes, mime: str, asr: ASRProvider,
                      message_id: str | None = None) -> None:
    # Bias the ASR towards this vehicle's own part names (spec 8.3). The
    # catalogue is already in memory from the parallel VIN workflow, so this
    # costs nothing and "slam panel" stops coming back as "slam pannel".
    _, vehicle = _catalogue(case)
    hints = vocabulary.phrase_hints(vehicle.slug if vehicle else None, case.zone)

    try:
        transcript = await speech_service.transcribe(asr, audio, mime, hints)
    except Exception:  # noqa: BLE001
        sse.publish(case.id, "analysis", {"stage": "asr", "error": "transcription_failed"})
        return

    message = next((m for m in case.messages if m.id == message_id), None)
    if message is None:
        message = cases.add_message(case, role="repairer", kind="voice")
    message.transcript = transcript.text
    message.transcript_conf = transcript.confidence

    # Pushed before extraction finishes, so the repairer sees their own words
    # immediately (spec 6.4).
    sse.publish(case.id, "transcript", {"message_id": message.id, "text": transcript.text})

    ingest_text(case, transcript.text, source="speech", source_ref=message.id)


def confirm_klass(case: Case, klass: str, damaged: bool) -> int:
    """Clamp every part of a class in the impact zone.

    Used when the repairer answers about a whole class ("the suspension") rather
    than a specific part, which is how they actually talk.
    """
    catalogue, _ = _catalogue(case)
    if catalogue is None:
        return 0

    touched = 0
    for part in catalogue.parts:
        if part.klass != klass or part.zone != case.zone:
            continue
        if case.side in ("L", "R") and part.side not in (case.side, "C"):
            continue
        cases.set_confirmation(case, part.part_id, damaged)
        if damaged:
            case.exposed_depth = max(case.exposed_depth, part.depth)
        touched += 1
    return touched


def retract_observations(case: Case, source_ref: str) -> int:
    """Drop the observations a single message produced.

    The observation table is append-only as a rule (spec 7.4), but a corrected
    transcript is not new evidence — it is a statement that the old evidence was
    never said. Leaving it in would mean a misheard part stayed in the report
    after the repairer fixed the words.
    """
    keep = [o for o in case.observations if o.source_ref != source_ref]
    removed = len(case.observations) - len(keep)
    case.observations = keep

    # Questions the retracted wording raised go with it. Otherwise a misheard
    # "rail" keeps being asked about after it was corrected to "grille".
    case.question_candidates = {
        klass: ref for klass, ref in case.question_candidates.items() if ref != source_ref
    }
    cases.touch(case)
    return removed


def ingest_text(case: Case, text: str, source: str = "speech",
                source_ref: str | None = None) -> None:
    """Shared path for a transcript and for typed text (spec 6.3)."""
    extracted = speech_service.extract(text)
    evidence_service.apply_speech(case, extracted)

    # A thing they raised and could not settle beats anything we merely inferred.
    for klass in extracted.question_candidates:
        case.question_candidates.setdefault(klass, source_ref)

    observations = [
        cases.make_observation(case.id, klass=klass, p=p, source=source, source_ref=source_ref)
        for klass, p in extracted.klasses.items()
    ]
    if observations:
        cases.add_observations(case, observations)

    # "the wheel looks straight" is a negative observation and should suppress,
    # not just fail to support.
    catalogue, _ = _catalogue(case)
    if catalogue is not None and extracted.cleared:
        for klass in extracted.cleared:
            for part in catalogue.parts:
                if part.klass == klass and part.zone == case.zone:
                    case.confirmations.setdefault(part.part_id, False)


def dispatch_analysis(case: Case, provider: VisionProvider, asr: ASRProvider) -> None:
    """Force a re-analysis (spec 6.5), used for retry and for the demo."""
    case.status = "analysing"
    assets = [a for a in case.media if a.kind in ("image", "video")]
    asyncio.create_task(_media_task(case, assets, provider, asr))


def seed_from_interpreter(case: Case) -> None:
    """Load the shipped Interpreter output as the first observation channel.

    Runs synchronously on case creation: it is a local JSON parse (spec 4.2
    budgets 50 ms) and it means the very first report a repairer sees is already
    populated rather than empty.
    """
    _, vehicle = _catalogue(case)
    if vehicle is None or not vehicle.slug:
        return
    payload = registry.prediction_for(vehicle.slug)
    if payload is None:
        return

    from app.catalogue import interpreter

    parsed = interpreter.parse(payload)
    case.zone = parsed.zone
    case.side = parsed.side
    case.severity = parsed.severity
    case.severity_source = "vision"
    case.impact_evidence = parsed.evidence[:8]
    case.impact_confidence = parsed.confidence
    case.conflicts = parsed.conflicts
    # Frames describing stripped-off components tell us how far teardown has
    # already got, which gates what is worth inspecting next.
    case.exposed_depth = max(case.exposed_depth, parsed.exposed_depth)

    cases.add_observations(
        case,
        [
            cases.make_observation(case.id, part_id=part.part_id, p=part.p, source="interpreter")
            for part in parsed.parts
        ]
        + [
            # OEM matching has not finished for this vehicle; assert the classes
            # from the raw part names instead of showing an empty report.
            cases.make_observation(case.id, klass=klass, p=p, source="interpreter")
            for klass, p in parsed.klasses.items()
        ],
    )
