import asyncio
import json
import logging
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

from services.config import OLLAMA
from services.system import _apply_image_generation_caps
from services.queue import queued_sse_stream
from services.media import (
    _WHISPER_AVAILABLE,
    _get_whisper,
    _DOCX_AVAILABLE,
    _ODF_AVAILABLE,
    _PDF_AVAILABLE,
    _BS4_AVAILABLE,
)
from services.research import _SEARCH_AVAILABLE

try:
    import image_gen as _image_gen
except ImportError:
    _image_gen = None

# Optional module imports for endpoint handlers

try:
    import docx as _docx_module
except ImportError:
    _docx_module = None

try:
    from odf.opendocument import load as _odf_load
    from odf.teletype import extractText as _odf_extract_text
    from odf import text as _odf_text
except ImportError:
    _odf_load = None
    _odf_extract_text = None
    _odf_text = None

try:
    import pypdf as _pypdf
except ImportError:
    _pypdf = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from ddgs import DDGS as _DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS as _DDGS
    except ImportError:
        _DDGS = None

log = logging.getLogger("offlineai")

router = APIRouter()


@router.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Stream transcription progress for an audio file using faster-whisper (SSE)."""
    if not _WHISPER_AVAILABLE:
        return JSONResponse(
            {"error": "Audio transcription requires faster-whisper. Install with: pip install faster-whisper"},
            status_code=501,
        )
    suffix = Path(file.filename).suffix if file.filename else ".wav"
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    model = await _get_whisper()

    async def event_stream():
        q: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _run():
            try:
                segments_iter, info = model.transcribe(tmp_path, beam_size=5)
                duration = max(info.duration or 0, 0.001)
                texts: list[str] = []
                for seg in segments_iter:
                    texts.append(seg.text)
                    pct = min(99, int(seg.end / duration * 100))
                    loop.call_soon_threadsafe(
                        q.put_nowait, {"type": "progress", "percent": pct}
                    )
                loop.call_soon_threadsafe(
                    q.put_nowait,
                    {"type": "done", "transcript": " ".join(texts).strip()},
                )
            except Exception as exc:
                loop.call_soon_threadsafe(
                    q.put_nowait, {"type": "error", "error": str(exc)}
                )
            finally:
                Path(tmp_path).unlink(missing_ok=True)

        threading.Thread(target=_run, daemon=True).start()

        while True:
            item = await q.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item["type"] in ("done", "error"):
                break

    return StreamingResponse(
        queued_sse_stream(event_stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract plain text from a Word (.docx) or ODF (.odt/.ods/.odp) document."""
    suffix = Path(file.filename).suffix.lower() if file.filename else ""
    content = await file.read()

    if suffix == ".docx":
        if not _DOCX_AVAILABLE:
            return JSONResponse(
                {"error": "python-docx is required. Install with: pip install python-docx"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_docx():
                doc = _docx_module.Document(tmp_path)
                return "\n".join(p.text for p in doc.paragraphs)
            text = await asyncio.to_thread(_read_docx)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    elif suffix in {".odt", ".ods", ".odp"}:
        if not _ODF_AVAILABLE:
            return JSONResponse(
                {"error": "odfpy is required. Install with: pip install odfpy"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_odf():
                odoc = _odf_load(tmp_path)
                paragraphs = odoc.getElementsByType(_odf_text.P)
                return "\n".join(_odf_extract_text(p) for p in paragraphs)
            text = await asyncio.to_thread(_read_odf)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    elif suffix == ".pdf":
        if not _PDF_AVAILABLE:
            return JSONResponse(
                {"error": "pypdf is required. Install with: pip install pypdf"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_pdf():
                reader = _pypdf.PdfReader(tmp_path)
                return "\n".join(
                    page.extract_text() or "" for page in reader.pages
                ).strip()
            text = await asyncio.to_thread(_read_pdf)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    else:
        return JSONResponse(
            {"error": f"Unsupported document format: '{suffix}'. Supported: .docx, .odt, .ods, .odp, .pdf"},
            status_code=415,
        )


@router.post("/api/search")
async def web_search(request: Request):
    """Perform a web search using DuckDuckGo and return results."""
    if not _SEARCH_AVAILABLE:
        return JSONResponse(
            {"error": "Web search requires duckduckgo-search. Install with: pip install duckduckgo-search"},
            status_code=501,
        )
    body = await request.json()
    query = (body.get("query") or "").strip()
    if not query:
        return JSONResponse({"error": "No search query provided"}, status_code=400)

    max_results = min(int(body.get("max_results", 5)), 10)

    def _do_search():
        try:
            ddgs = _DDGS()
            results = list(ddgs.text(query, max_results=max_results))
            return results
        except Exception as exc:
            return {"error": str(exc)}

    results = await asyncio.to_thread(_do_search)
    if isinstance(results, dict) and "error" in results:
        return JSONResponse({"error": results["error"]}, status_code=502)

    return {"query": query, "results": results}


@router.post("/api/generate-image")
async def generate_image(request: Request):
    """Generate an image using a local Diffusers pipeline.
    Streams NDJSON progress events to match the frontend contract."""
    body = _apply_image_generation_caps(await request.json())

    async def _stream():
        if _image_gen is None:
            yield json.dumps({"error": "Image generation module not available. Install torch and diffusers."}) + "\n"
            return
        try:
            # Check availability first
            status = _image_gen.get_status()
            if not status["available"]:
                yield json.dumps({"error": status["error"]}) + "\n"
                return

            # Signal model loading if not yet loaded
            if not status["model_loaded"]:
                yield json.dumps({"status": "Loading image model…"}) + "\n"

            yield json.dumps({"status": "Generating image…", "progress": 10}) + "\n"

            b64_image = await _image_gen.generate_image(
                prompt=body.get("prompt", ""),
                width=body.get("width", 768),
                height=body.get("height", 768),
                steps=body.get("steps", 10),
                negative_prompt=body.get("negative_prompt"),
                seed=body.get("seed"),
            )

            yield json.dumps({"status": "Generating image…", "progress": 90}) + "\n"
            yield json.dumps({"image": b64_image, "response": b64_image, "done": True}) + "\n"

        except Exception as exc:
            log.error("Image generation failed: %s", exc)
            yield json.dumps({"error": str(exc)}) + "\n"

    return StreamingResponse(queued_sse_stream(_stream()), media_type="application/x-ndjson")


@router.post("/api/fetch-page")
async def fetch_page(request: Request):
    """Fetch a URL, strip HTML, return clean text."""
    if not _BS4_AVAILABLE:
        return JSONResponse(
            {"error": "beautifulsoup4 is required. Install with: pip install beautifulsoup4 lxml"},
            status_code=501,
        )
    body = await request.json()
    url = (body.get("url") or "").strip()
    if not url:
        return JSONResponse({"error": "No URL provided"}, status_code=400)
    max_chars = int(body.get("max_chars", 8000))

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        return JSONResponse({"error": f"Failed to fetch URL: {exc}"}, status_code=502)

    soup = BeautifulSoup(resp.text, "lxml")

    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    title = soup.title.get_text(strip=True) if soup.title else ""
    content = soup.get_text(separator='\n', strip=True)
    content = content[:max_chars]

    return {"url": url, "title": title, "content": content}
