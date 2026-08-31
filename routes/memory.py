from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from services.memory import _load_memories, _add_memory, _remove_memory

router = APIRouter()


@router.get("/api/memory")
async def get_memories():
    return {"memories": _load_memories()}


@router.post("/api/memory")
async def add_memory_endpoint(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "No memory text provided"}, status_code=400)
    _add_memory(text)
    return {"ok": True, "memories": _load_memories()}


@router.delete("/api/memory/{index}")
async def remove_memory_endpoint(index: int):
    if _remove_memory(index):
        return {"ok": True, "memories": _load_memories()}
    return JSONResponse({"error": "Invalid index"}, status_code=404)
