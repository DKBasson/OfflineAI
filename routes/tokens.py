from fastapi import APIRouter
from fastapi.responses import JSONResponse

from services.tokens import _token_stats, _save_token_stats

router = APIRouter()


@router.get("/api/tokens")
async def get_tokens():
    return JSONResponse(_token_stats)


@router.delete("/api/tokens")
async def reset_user_tokens(user: str = ""):
    if user and user in _token_stats:
        del _token_stats[user]
        _save_token_stats()
    return JSONResponse({"ok": True})
