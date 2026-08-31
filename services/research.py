import logging
import re
from pathlib import Path

import httpx

from services.config import OLLAMA
from services.system import _PDF_CSS

log = logging.getLogger("offlineai")

try:
    from bs4 import BeautifulSoup
    _BS4_AVAILABLE = True
except ImportError:
    _BS4_AVAILABLE = False

try:
    import markdown as _markdown_lib
    _MARKDOWN_AVAILABLE = True
except ImportError:
    _MARKDOWN_AVAILABLE = False

try:
    import weasyprint as _weasyprint
    _WEASYPRINT_AVAILABLE = True
except ImportError:
    _WEASYPRINT_AVAILABLE = False

try:
    from ddgs import DDGS as _DDGS
    _SEARCH_AVAILABLE = True
except ImportError:
    try:
        from duckduckgo_search import DDGS as _DDGS
        _SEARCH_AVAILABLE = True
    except ImportError:
        _SEARCH_AVAILABLE = False


import asyncio


async def _generate_search_queries(topic: str, num_queries: int, model: str) -> list[str]:
    """Use LLM to generate diverse search queries for a research topic."""
    prompt = f"""Generate exactly {num_queries} diverse web search queries to research the topic: "{topic}"

Rules:
- Each query should explore a different angle or aspect of the topic
- Queries should be specific enough to get relevant results
- Include a mix of overview queries and specific detail queries
- Return ONLY the queries, one per line, no numbering, no explanations"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 512},
            })
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            queries = [q.strip().strip('"').strip("'") for q in content.strip().split("\n") if q.strip()]
            queries = [re.sub(r'^[\d]+[.)\s]+|^[-*]\s+', '', q).strip() for q in queries]
            return queries[:num_queries] if queries else [topic]
    except Exception:
        return [topic]


async def _do_web_search(query: str, max_results: int = 5) -> list[dict]:
    """Perform a web search using DuckDuckGo."""
    if not _SEARCH_AVAILABLE:
        return []
    try:
        def _search():
            ddgs = _DDGS()
            return list(ddgs.text(query, max_results=max_results))
        return await asyncio.to_thread(_search)
    except Exception:
        return []


async def _fetch_page_content(url: str, max_chars: int = 4000) -> str:
    """Fetch and extract text content from a URL."""
    if not _BS4_AVAILABLE:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                return ""
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        return text[:max_chars]
    except Exception:
        return ""


async def _extract_findings(topic: str, page_contents: list[str], model: str) -> str:
    """Use LLM to extract key findings from collected source material."""
    if not page_contents:
        return "No source content available to analyze."

    combined = "\n\n---\n\n".join(page_contents[:10])
    combined = combined[:24000]

    prompt = f"""Analyze the following source material about "{topic}" and extract the key findings.

Source material:
{combined}

Provide a structured list of key findings, facts, and insights. Be specific and factual. Include relevant data points, dates, and names where available.
For each finding, note which source it came from by including the source name in parentheses at the end, e.g. "Finding text (Source: Article Title)"."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
            })
            data = resp.json()
            return data.get("message", {}).get("content", "Unable to extract findings.")
    except Exception as exc:
        return f"Error extracting findings: {exc}"


async def _synthesize_summary(topic: str, findings: str, sources: list[dict], model: str) -> str:
    """Use LLM to write a comprehensive research summary."""
    sources_list = "\n".join(f"[{i}] {s.get('title', 'Unknown')}: {s.get('url', '')}" for i, s in enumerate(sources[:15], 1))

    prompt = f"""Write a comprehensive research summary about "{topic}" based on the following findings and sources.

Key Findings:
{findings}

Numbered Sources:
{sources_list}

Write a well-structured Markdown document with:
1. A title (# heading)
2. An executive summary paragraph
3. Key findings organized by theme (## subheadings)
4. A "## References" section at the end listing all cited sources as a numbered list

CITATION RULES (you MUST follow these):
- Use inline citation markers like [1], [2], etc. to reference the numbered sources above.
- Place the citation marker immediately after the claim or fact it supports.
- Every factual claim should have at least one citation.
- In the References section, list each cited source as: [N] Title — URL
- Only cite sources from the numbered list above. Do not invent sources.

Be thorough and factual."""

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 8192, "num_ctx": 32768},
            })
            data = resp.json()
            return data.get("message", {}).get("content", "Unable to generate summary.")
    except Exception as exc:
        return f"# Research Summary: {topic}\n\nError generating summary: {exc}\n\n## Findings\n\n{findings}"


def _save_markdown_as_pdf(md_content: str, pdf_path: Path, title: str = "") -> None:
    """Convert Markdown content to a human-readable PDF and save to disk."""
    if not _WEASYPRINT_AVAILABLE or not _MARKDOWN_AVAILABLE:
        return
    html_body = _markdown_lib.markdown(md_content, extensions=["tables", "fenced_code", "toc", "nl2br"])
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>
{_PDF_CSS}
</style></head><body>{html_body}</body></html>"""
    doc = _weasyprint.HTML(string=html)
    doc.write_pdf(str(pdf_path))
    log.info("PDF saved: %s", pdf_path.name)
