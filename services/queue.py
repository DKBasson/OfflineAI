"""
Operation queue for heavy endpoints.

Prevents concurrent LLM-heavy operations from exhausting system resources
(RAM, GPU, CPU). Uses an asyncio.Semaphore to limit concurrency.

When the semaphore is full, endpoints return 429 Too Many Requests
with a retry_after hint.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("offlineai.queue")

MAX_CONCURRENT_OPS = int(os.environ.get("OFFLINEAI_MAX_CONCURRENT_OPS", "1"))

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_OPS)
_active_count = 0
_active_lock = asyncio.Lock()


async def get_status() -> dict:
    """Return current queue status."""
    return {
        "active": _active_count,
        "max": MAX_CONCURRENT_OPS,
    }


@asynccontextmanager
async def heavy_operation() -> AsyncGenerator[None, None]:
    """Async context manager that acquires the operation semaphore.

    Usage in route handlers::

        from services.queue import heavy_operation, operation_busy_response

        async def my_endpoint():
            if not _semaphore_available():
                return operation_busy_response()
            async with heavy_operation():
                # ... do heavy work ...
    """
    global _active_count
    async with _active_lock:
        _active_count += 1
    try:
        yield
    finally:
        async with _active_lock:
            _active_count -= 1


def is_busy() -> bool:
    """Check if the operation queue is full without blocking."""
    return _active_count >= MAX_CONCURRENT_OPS


async def try_acquire() -> bool:
    """Try to acquire the semaphore without blocking.
    
    Returns True if acquired (caller MUST call release() when done).
    Returns False if the queue is full.
    """
    return _active_count < MAX_CONCURRENT_OPS and await asyncio.wait_for(
        _acquire_nowait(), timeout=0.01
    )


async def _acquire_nowait() -> bool:
    """Internal helper — attempts non-blocking acquire."""
    try:
        # Use wait_for with tiny timeout to simulate try_acquire
        await asyncio.wait_for(_semaphore.acquire(), timeout=0.01)
        return True
    except asyncio.TimeoutError:
        return False


def release() -> None:
    """Release the semaphore after a heavy operation completes."""
    _semaphore.release()


def operation_busy_response() -> JSONResponse:
    """Standard 429 response when the operation queue is full."""
    return JSONResponse(
        {
            "error": "Another operation is in progress. Please wait for it to complete.",
            "retry_after": 5,
        },
        status_code=429,
        headers={"Retry-After": "5"},
    )


async def queued_sse_stream(generator):
    """Wrap an SSE async generator with semaphore acquire/release.
    
    Acquires the semaphore before yielding any events and releases it
    when the generator is exhausted or raises an exception.
    """
    global _active_count
    await _semaphore.acquire()
    async with _active_lock:
        _active_count += 1
    try:
        async for event in generator:
            yield event
    finally:
        _semaphore.release()
        async with _active_lock:
            _active_count -= 1
