"""Tests for services/versions.py — artifact version history."""

import pytest

import services.config
from services import projects, versions


@pytest.fixture(autouse=True)
def _isolate_versions(monkeypatch, tmp_path):
    """Point PROJECTS_DIR to a temp directory for both projects and versions."""
    monkeypatch.setattr(services.config, "PROJECTS_DIR", tmp_path)
    monkeypatch.setattr(projects, "PROJECTS_DIR", tmp_path)
    monkeypatch.setattr(versions, "PROJECTS_DIR", tmp_path)


@pytest.fixture
def project_file(tmp_path):
    """Create a project with a single file and return (project_id, relative_path)."""
    pid = "demo-project"
    pdir = tmp_path / pid / "output"
    pdir.mkdir(parents=True)
    f = pdir / "report.md"
    f.write_text("version-0 content", encoding="utf-8")
    return pid, "output/report.md"


def test_save_creates_versions_dir(project_file, tmp_path):
    pid, fpath = project_file
    ver = versions.save_version(pid, fpath)
    assert ver == 1
    ver_dir = tmp_path / pid / ".versions" / fpath
    assert ver_dir.is_dir()


def test_list_versions_returns_saved(project_file):
    pid, fpath = project_file
    versions.save_version(pid, fpath)
    versions.save_version(pid, fpath)
    result = versions.list_versions(pid, fpath)
    assert len(result) == 2
    assert result[0]["version"] == 1
    assert result[1]["version"] == 2


def test_get_version_returns_content(project_file, tmp_path):
    pid, fpath = project_file
    versions.save_version(pid, fpath)

    # Mutate the live file, then save again
    live = tmp_path / pid / "output" / "report.md"
    live.write_text("version-1 content", encoding="utf-8")
    versions.save_version(pid, fpath)

    assert versions.get_version(pid, fpath, 1) == "version-0 content"
    assert versions.get_version(pid, fpath, 2) == "version-1 content"


def test_restore_swaps_content(project_file, tmp_path):
    pid, fpath = project_file
    versions.save_version(pid, fpath)  # v1 = "version-0 content"

    live = tmp_path / pid / "output" / "report.md"
    live.write_text("modified content", encoding="utf-8")

    ok = versions.restore_version(pid, fpath, 1)
    assert ok is True
    assert live.read_text(encoding="utf-8") == "version-0 content"


def test_max_five_versions_enforced(project_file, tmp_path):
    pid, fpath = project_file
    live = tmp_path / pid / "output" / "report.md"

    for i in range(7):
        live.write_text(f"content-{i}", encoding="utf-8")
        versions.save_version(pid, fpath)

    result = versions.list_versions(pid, fpath)
    assert len(result) <= versions.MAX_VERSIONS


def test_save_nonexistent_file_returns_none(tmp_path):
    pid = "empty-project"
    (tmp_path / pid).mkdir()
    assert versions.save_version(pid, "does-not-exist.txt") is None


def test_get_nonexistent_version_returns_none(project_file):
    pid, fpath = project_file
    assert versions.get_version(pid, fpath, 999) is None
