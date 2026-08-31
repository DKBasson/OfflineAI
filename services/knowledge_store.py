"""
SQLite FTS5-based knowledge retrieval for OfflineAI projects.

Replaces the fixed truncation approach with relevance-based retrieval
using BM25 ranking. Each project gets its own `.knowledge.db` file
alongside the existing `knowledge.json`.

Falls back to the legacy truncation approach if the database doesn't exist.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from services.config import PROJECTS_DIR

log = logging.getLogger("offlineai.knowledge")

_DB_FILENAME = ".knowledge.db"


def _db_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / _DB_FILENAME


def _get_connection(project_id: str) -> sqlite3.Connection:
    """Open (or create) the FTS5 database for a project."""
    db = _db_path(project_id)
    conn = sqlite3.connect(str(db))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            topic,
            content,
            source_url,
            entry_type,
            timestamp,
            tokenize='porter unicode61'
        )
    """)
    conn.commit()
    return conn


def index_finding(project_id: str, finding: dict) -> None:
    """Add a single finding to the FTS index."""
    try:
        conn = _get_connection(project_id)
        conn.execute(
            "INSERT INTO knowledge_fts (topic, content, source_url, entry_type, timestamp) VALUES (?, ?, ?, ?, ?)",
            (
                finding.get("topic", ""),
                finding.get("summary", ""),
                ", ".join(finding.get("sources", [])) if isinstance(finding.get("sources"), list) else "",
                "finding",
                finding.get("timestamp", ""),
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning("Failed to index finding: %s", e)


def index_source(project_id: str, source: dict) -> None:
    """Add a source entry to the FTS index."""
    try:
        conn = _get_connection(project_id)
        conn.execute(
            "INSERT INTO knowledge_fts (topic, content, source_url, entry_type, timestamp) VALUES (?, ?, ?, ?, ?)",
            (
                source.get("title", ""),
                source.get("content", source.get("snippet", "")),
                source.get("url", ""),
                "source",
                source.get("timestamp", ""),
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning("Failed to index source: %s", e)


def reindex_project(project_id: str) -> int:
    """Rebuild the FTS index from knowledge.json.
    
    Returns the number of entries indexed.
    """
    knowledge_file = PROJECTS_DIR / project_id / "knowledge.json"
    if not knowledge_file.exists():
        return 0

    try:
        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("Failed to read knowledge.json for reindex: %s", e)
        return 0

    # Drop and recreate
    db = _db_path(project_id)
    if db.exists():
        db.unlink()

    conn = _get_connection(project_id)
    count = 0

    for finding in knowledge.get("findings", []):
        conn.execute(
            "INSERT INTO knowledge_fts (topic, content, source_url, entry_type, timestamp) VALUES (?, ?, ?, ?, ?)",
            (
                finding.get("topic", ""),
                finding.get("summary", ""),
                ", ".join(finding.get("sources", [])) if isinstance(finding.get("sources"), list) else "",
                "finding",
                finding.get("timestamp", ""),
            ),
        )
        count += 1

    for source in knowledge.get("sources", []):
        conn.execute(
            "INSERT INTO knowledge_fts (topic, content, source_url, entry_type, timestamp) VALUES (?, ?, ?, ?, ?)",
            (
                source.get("title", ""),
                source.get("content", source.get("snippet", "")),
                source.get("url", ""),
                "source",
                source.get("timestamp", ""),
            ),
        )
        count += 1

    conn.commit()
    conn.close()
    log.info("Reindexed project %s: %d entries", project_id, count)
    return count


def _sanitize_fts_query(query: str) -> str:
    """Sanitize a query string for FTS5 MATCH.

    Splits on whitespace, strips non-alphanumeric characters from each word,
    wraps survivors in double quotes, and joins with spaces.
    Example: 'Python OR framework' → '"Python" "framework"'
    """
    import re
    words = query.split()
    sanitized = []
    for w in words:
        cleaned = re.sub(r'[^a-zA-Z0-9]', '', w)
        if cleaned:
            sanitized.append(f'"{cleaned}"')
    return " ".join(sanitized)


def search(project_id: str, query: str, limit: int = 10) -> list[dict]:
    """Search the project knowledge using FTS5 BM25 ranking.
    
    Returns a list of dicts with: topic, content, source_url, entry_type, rank.
    """
    safe_query = _sanitize_fts_query(query)
    if not safe_query:
        return []

    db = _db_path(project_id)
    if not db.exists():
        # Try to create index from knowledge.json
        indexed = reindex_project(project_id)
        if indexed == 0:
            return []

    try:
        conn = _get_connection(project_id)
        # Use BM25 ranking — lower rank = more relevant
        try:
            cursor = conn.execute(
                """
                SELECT topic, content, source_url, entry_type, rank
                FROM knowledge_fts
                WHERE knowledge_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (safe_query, limit),
            )
            results = []
            for row in cursor:
                results.append({
                    "topic": row[0],
                    "content": row[1],
                    "source_url": row[2],
                    "entry_type": row[3],
                    "rank": row[4],
                })
        except Exception as e:
            log.warning("FTS5 MATCH query failed for project %s: %s", project_id, e)
            conn.close()
            return []
        conn.close()
        return results
    except Exception as e:
        log.warning("FTS5 search failed for project %s: %s", project_id, e)
        return []


def format_search_results(results: list[dict], max_chars: int = 8000) -> str:
    """Format FTS5 search results as context for the LLM."""
    if not results:
        return ""

    parts = ["--- PROJECT KNOWLEDGE (relevant to your query) ---", ""]

    findings = [r for r in results if r["entry_type"] == "finding"]
    sources = [r for r in results if r["entry_type"] == "source"]

    if findings:
        parts.append("Key Findings:")
        for i, f in enumerate(findings, 1):
            parts.append(f"{i}. [{f['topic']}] {f['content'][:400]}")
        parts.append("")

    if sources:
        parts.append("Available Sources (use [N] to cite inline):")
        for i, s in enumerate(sources, 1):
            parts.append(f"[{i}] {s['topic']}: {s['source_url']}")

    parts.append("---")

    context = "\n".join(parts)
    return context[:max_chars]
