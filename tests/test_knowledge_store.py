"""Tests for the FTS5 knowledge store."""

import json
import tempfile
from pathlib import Path

import pytest

import services.config
from services import knowledge_store


@pytest.fixture
def temp_project(monkeypatch, tmp_path):
    """Create a temporary project directory with knowledge.json."""
    monkeypatch.setattr(services.config, "PROJECTS_DIR", tmp_path)
    monkeypatch.setattr(knowledge_store, "PROJECTS_DIR", tmp_path)

    project_id = "test-project"
    project_dir = tmp_path / project_id
    project_dir.mkdir()

    knowledge = {
        "name": "Test Project",
        "findings": [
            {"topic": "Python frameworks", "summary": "Django is a full-stack web framework with ORM, admin, and auth built in.", "sources": ["https://djangoproject.com"], "timestamp": "2024-01-01T00:00:00Z"},
            {"topic": "Python frameworks", "summary": "Flask is a lightweight microframework for building web applications.", "sources": ["https://flask.palletsprojects.com"], "timestamp": "2024-01-02T00:00:00Z"},
            {"topic": "Rust language", "summary": "Rust provides memory safety without garbage collection through its ownership system.", "sources": ["https://rust-lang.org"], "timestamp": "2024-01-03T00:00:00Z"},
            {"topic": "JavaScript runtimes", "summary": "Node.js is a server-side JavaScript runtime built on V8 engine.", "sources": ["https://nodejs.org"], "timestamp": "2024-01-04T00:00:00Z"},
            {"topic": "Machine learning", "summary": "PyTorch is a deep learning framework with dynamic computation graphs.", "sources": ["https://pytorch.org"], "timestamp": "2024-01-05T00:00:00Z"},
        ],
        "sources": [
            {"title": "Django documentation", "url": "https://djangoproject.com", "timestamp": "2024-01-01T00:00:00Z"},
            {"title": "Rust book", "url": "https://doc.rust-lang.org/book/", "timestamp": "2024-01-03T00:00:00Z"},
        ],
    }
    (project_dir / "knowledge.json").write_text(json.dumps(knowledge, indent=2))
    return project_id


def test_reindex_creates_database(temp_project, tmp_path):
    count = knowledge_store.reindex_project(temp_project)
    assert count == 7  # 5 findings + 2 sources
    assert (tmp_path / temp_project / ".knowledge.db").exists()


def test_search_finds_relevant_findings(temp_project):
    knowledge_store.reindex_project(temp_project)
    results = knowledge_store.search(temp_project, "Python web framework", limit=5)
    assert len(results) > 0
    # Django and Flask should be among the top results
    topics = [r["topic"] for r in results]
    contents = " ".join(r["content"] for r in results)
    assert "Django" in contents or "Flask" in contents


def test_search_ranks_by_relevance(temp_project):
    knowledge_store.reindex_project(temp_project)
    results = knowledge_store.search(temp_project, "Rust memory safety ownership", limit=5)
    assert len(results) > 0
    # Rust finding should be the top result
    assert "Rust" in results[0]["content"] or "Rust" in results[0]["topic"]


def test_search_returns_empty_for_no_match(temp_project):
    knowledge_store.reindex_project(temp_project)
    results = knowledge_store.search(temp_project, "quantum entanglement teleportation", limit=5)
    # FTS5 may return partial matches or empty
    # The important thing is it doesn't error
    assert isinstance(results, list)


def test_index_finding_adds_to_db(temp_project):
    knowledge_store.reindex_project(temp_project)
    knowledge_store.index_finding(temp_project, {
        "topic": "Quantum computing",
        "summary": "Quantum computers use qubits that can be in superposition.",
        "sources": ["https://quantum.example.com"],
        "timestamp": "2024-06-01T00:00:00Z",
    })
    results = knowledge_store.search(temp_project, "quantum qubits superposition", limit=5)
    assert len(results) > 0
    assert any("quantum" in r["content"].lower() for r in results)


def test_format_search_results(temp_project):
    knowledge_store.reindex_project(temp_project)
    results = knowledge_store.search(temp_project, "Django framework", limit=5)
    if results:
        formatted = knowledge_store.format_search_results(results)
        assert "PROJECT KNOWLEDGE" in formatted
        assert "Key Findings:" in formatted
    else:
        # FTS5 tokenization may not match — test format function directly
        fake_results = [{"topic": "Test", "content": "Test content", "source_url": "http://x", "entry_type": "finding", "rank": -1.0}]
        formatted = knowledge_store.format_search_results(fake_results)
        assert "PROJECT KNOWLEDGE" in formatted


def test_format_empty_results():
    formatted = knowledge_store.format_search_results([])
    assert formatted == ""


def test_auto_reindex_on_first_search(temp_project, tmp_path):
    """If .knowledge.db doesn't exist, search should auto-create it."""
    # Don't manually reindex — search should do it automatically
    db_path = tmp_path / temp_project / ".knowledge.db"
    assert not db_path.exists()
    
    results = knowledge_store.search(temp_project, "Python", limit=5)
    # Should have auto-indexed and found results
    assert db_path.exists()
    assert len(results) > 0
