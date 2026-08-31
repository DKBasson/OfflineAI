"""Tests for services/projects.py — slugify, path resolution, parsing."""

import json

import pytest

import services.config
from services import projects


@pytest.fixture(autouse=True)
def _isolate_projects(monkeypatch, tmp_path):
    """Point PROJECTS_DIR to a temp directory."""
    monkeypatch.setattr(services.config, "PROJECTS_DIR", tmp_path)
    monkeypatch.setattr(projects, "PROJECTS_DIR", tmp_path)


# ── _slugify ──────────────────────────────────────────────────────────


def test_slugify_basic():
    assert projects._slugify("Hello World") == "hello-world"


def test_slugify_special_chars():
    """Non-alphanumeric chars are stripped, accents normalised."""
    assert projects._slugify("Café & Résumé!") == "cafe-resume"


def test_slugify_extra_whitespace():
    assert projects._slugify("  lots   of   spaces  ") == "lots-of-spaces"


# ── _resolve_project_path ────────────────────────────────────────────


def test_resolve_path_within_project(tmp_path):
    project_dir = tmp_path / "my-project"
    project_dir.mkdir()
    result = projects._resolve_project_path("my-project", "notes", "file.md")
    assert result is not None
    assert str(result).endswith("my-project/notes/file.md")


def test_resolve_path_traversal_rejected(tmp_path):
    project_dir = tmp_path / "my-project"
    project_dir.mkdir()
    result = projects._resolve_project_path("my-project", "..", "etc", "passwd")
    assert result is None


# ── _parse_code_files ────────────────────────────────────────────────


def test_parse_code_files_with_markers():
    content = (
        "=== FILE: src/main.py ===\n"
        "print('hello')\n"
        "=== END FILE ===\n"
        "\n"
        "=== FILE: README.md ===\n"
        "# Readme\n"
        "=== END FILE ===\n"
    )
    files = projects._parse_code_files(content)
    assert len(files) == 2
    assert files[0] == ("src/main.py", "print('hello')")
    assert files[1] == ("README.md", "# Readme")


def test_parse_code_files_empty():
    assert projects._parse_code_files("no markers here") == []


# ── _parse_workflow_plan ─────────────────────────────────────────────


def test_parse_workflow_plan_json():
    plan = json.dumps([
        {"type": "research", "topic": "AI safety"},
        {"type": "document", "topic": "AI safety report"},
    ])
    result = projects._parse_workflow_plan(plan)
    assert len(result) == 2
    assert result[0]["type"] == "research"


def test_parse_workflow_plan_fenced():
    text = "Here is the plan:\n```json\n" + json.dumps([
        {"type": "code", "topic": "Flask API"},
    ]) + "\n```"
    result = projects._parse_workflow_plan(text)
    assert len(result) == 1
    assert result[0]["type"] == "code"


def test_parse_workflow_plan_filters_invalid():
    plan = json.dumps([
        {"type": "research", "topic": "valid"},
        {"type": "invalid_type", "topic": "bad"},
        "not a dict",
    ])
    result = projects._parse_workflow_plan(plan)
    assert len(result) == 1


def test_parse_workflow_plan_garbage():
    assert projects._parse_workflow_plan("this is not JSON at all") == []
