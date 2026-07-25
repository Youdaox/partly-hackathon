"""In-process SSE fan-out, keyed by case id (spec 4.4).

No broker. Background tasks push events onto per-subscriber asyncio queues and
the streaming endpoint drains them. A case with no listener drops its events on
the floor, which is correct: the client re-reads the full state on connect, so
nothing is lost by missing a push (principle 1 — every intermediate answer is
valid and the report is always sent whole).
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

# Bounded so a client that stops reading cannot grow memory without limit.
QUEUE_SIZE = 64

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(case_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
    _subscribers[case_id].add(queue)
    return queue


def unsubscribe(case_id: str, queue: asyncio.Queue) -> None:
    listeners = _subscribers.get(case_id)
    if not listeners:
        return
    listeners.discard(queue)
    if not listeners:
        _subscribers.pop(case_id, None)


def publish(case_id: str, event: str, data: Any) -> None:
    """Never blocks and never raises: a slow client must not stall a task."""
    for queue in list(_subscribers.get(case_id, ())):
        try:
            queue.put_nowait((event, data))
        except asyncio.QueueFull:
            pass


def format_event(event: str, data: Any) -> str:
    body = data if isinstance(data, str) else json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {body}\n\n"


def listener_count(case_id: str) -> int:
    return len(_subscribers.get(case_id, ()))
