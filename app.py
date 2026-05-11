import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

app = FastAPI(title="OfflineAI")

OLLAMA     = "http://localhost:11434"
STATIC_DIR = Path(__file__).parent / "static"
MAX_BODY   = 50 * 1024 * 1024  # 50 MB

# Cache static files at startup
_BASE = Path(__file__).parent
_INDEX_HTML = (_BASE / "index.html").read_text(encoding="utf-8")
_STYLES_CSS = (_BASE / "styles.css").read_text(encoding="utf-8")

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY:
        return JSONResponse({"error": "Request body too large (max 50 MB)"}, status_code=413)
    return await call_next(request)


@app.get("/", response_class=HTMLResponse)
async def root():
    return HTMLResponse(_INDEX_HTML)


@app.get("/styles.css")
async def styles():
    from fastapi.responses import Response
    return Response(_STYLES_CSS, media_type="text/css")


@app.get("/api/models")
async def get_models():
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA}/api/tags")
            return r.json()
    except Exception:
        return {"models": [{"name": "gemma4:e4b"}]}


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()

    async def stream_ollama():
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=None, write=120.0, pool=5.0)
            ) as client:
                async with client.stream(
                    "POST", f"{OLLAMA}/api/chat", json=body
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
        except httpx.ConnectError:
            err = json.dumps(
                {"error": "Cannot connect to Ollama. Start it with: ollama serve"}
            )
            yield (err + "\n").encode()
        except Exception as exc:
            err = json.dumps({"error": str(exc)})
            yield (err + "\n").encode()

    return StreamingResponse(stream_ollama(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import socket
    import uvicorn

    host = "0.0.0.0"
    port = 8080

    # Resolve the LAN IP for display (UDP trick — no data sent)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        lan_ip = "127.0.0.1"

    print("══════════════════════════════════════════")
    print("  OfflineAI")
    print(f"  Local:    http://127.0.0.1:{port}")
    print(f"  Network:  http://{lan_ip}:{port}")
    print("══════════════════════════════════════════")
    print("Make sure Ollama is running: ollama serve")
    print("Make sure model is available: ollama pull gemma4:e4b")
    uvicorn.run(app, host=host, port=port)
