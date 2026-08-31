"""Tests for services/memory.py — persistent user preferences."""

import json
from pathlib import Path

import pytest

import services.config
from services import memory


@pytest.fixture(autouse=True)
def _isolate_memory(monkeypatch, tmp_path):
    """Redirect all memory I/O to a temp directory."""
    mem_dir = tmp_path / "mem"
    mem_dir.mkdir()
    mem_file = mem_dir / "preferences.json"
    mem_file.write_text("[]", encoding="utf-8")

    monkeypatch.setattr(services.config, "MEMORY_DIR", mem_dir)
    monkeypatch.setattr(memory, "MEMORY_DIR", mem_dir)
    monkeypatch.setattr(memory, "_MEMORY_FILE", mem_file)


def test_load_empty():
    """Loading from an empty JSON array returns an empty list."""
    assert memory._load_memories() == []


def test_add_memory():
    """Adding a memory persists it and it can be loaded back."""
    memory._add_memory("Always use dark mode")
    result = memory._load_memories()
    assert result == ["Always use dark mode"]


def test_add_memory_deduplicates():
    """Adding the same text twice should not create a duplicate."""
    memory._add_memory("Prefer Python 3.12")
    memory._add_memory("Prefer Python 3.12")
    result = memory._load_memories()
    assert result == ["Prefer Python 3.12"]


def test_remove_memory_by_index():
    """Removing by index deletes the correct entry and returns True."""
    memory._add_memory("first")
    memory._add_memory("second")
    memory._add_memory("third")

    assert memory._remove_memory(1) is True
    assert memory._load_memories() == ["first", "third"]


def test_remove_memory_invalid_index():
    """Removing with an out-of-range index returns False."""
    memory._add_memory("only")
    assert memory._remove_memory(5) is False
    assert memory._remove_memory(-1) is False


def test_get_memory_context_format():
    """_get_memory_context returns the expected header/footer format."""
    memory._add_memory("Use metric units")
    memory._add_memory("Reply in English")

    ctx = memory._get_memory_context()
    assert ctx.startswith("--- USER PREFERENCES (always follow these) ---")
    assert "- Use metric units" in ctx
    assert "- Reply in English" in ctx
    assert ctx.endswith("---")


def test_get_memory_context_empty():
    """With no memories, context is an empty string."""
    assert memory._get_memory_context() == ""
