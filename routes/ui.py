from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from services.config import _REACT_DIST, _REACT_MODE

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def root():
    if _REACT_MODE:
        return HTMLResponse((_REACT_DIST / "index.html").read_text(encoding="utf-8"))
    return HTMLResponse(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>OfflineAI</title>"
        "<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;"
        "justify-content:center;min-height:100vh;margin:0;background:#07080f;color:#e0e0e0;}"
        ".c{text-align:center} code{background:#1a1a2e;padding:2px 8px;border-radius:4px;}</style>"
        "</head><body><div class='c'><h1>OfflineAI</h1>"
        "<p>Frontend not built. Run:</p>"
        "<pre><code>cd react-app &amp;&amp; npm install &amp;&amp; npm run build</code></pre>"
        "</div></body></html>"
    )
