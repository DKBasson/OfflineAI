"""Tests for the operation queue."""

import asyncio
import pytest
from services.queue import get_status, is_busy, queued_sse_stream, _semaphore, _active_count


@pytest.fixture(autouse=True)
def reset_semaphore():
    """Ensure semaphore is released between tests."""
    # Ensure clean state
    while _semaphore._value < 1:
        _semaphore.release()
    yield
    while _semaphore._value < 1:
        _semaphore.release()


@pytest.mark.asyncio
async def test_queue_status_initial():
    status = await get_status()
    assert status["max"] == 1
    assert status["active"] == 0


@pytest.mark.asyncio
async def test_queue_not_busy_initially():
    assert not is_busy()


@pytest.mark.asyncio
async def test_queued_stream_acquires_and_releases():
    """Semaphore is acquired during stream and released after."""
    assert _semaphore._value == 1  # available

    async def fake_generator():
        # During generation, semaphore should be held
        assert _semaphore._value == 0
        yield "event1"
        yield "event2"

    results = []
    async for event in queued_sse_stream(fake_generator()):
        results.append(event)

    assert results == ["event1", "event2"]
    assert _semaphore._value == 1  # released


@pytest.mark.asyncio
async def test_queued_stream_releases_on_error():
    """Semaphore is released even if the generator raises."""
    async def failing_generator():
        yield "event1"
        raise RuntimeError("boom")

    results = []
    with pytest.raises(RuntimeError, match="boom"):
        async for event in queued_sse_stream(failing_generator()):
            results.append(event)

    assert results == ["event1"]
    assert _semaphore._value == 1  # released despite error
