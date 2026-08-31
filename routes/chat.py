import asyncio
import json
import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
import httpx

import services.config as _svc_config
from services.memory import _get_memory_context
from services.projects import _get_project_knowledge_context
from services.tools import (
    _get_tools_summary,
    _pre_match_tools,
    _execute_tool,
)
from services.ollama import _chat_with_tool_execution
from services.prompt_assembly import build_system_prompt

log = logging.getLogger("offlineai")

router = APIRouter()


@router.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    client_host = request.client.host if request.client else "unknown"
    log.debug("Chat request from %s model=%s messages=%d", client_host, body.get("model", "?"), len(body.get("messages", [])))

    # ── Gather context sources ───────────────────────────────────────
    memory_context = _get_memory_context() or None

    project_id = body.pop("project_id", None)
    knowledge_context = None
    if project_id:
        # Extract user's last message for relevance-based knowledge retrieval
        user_messages = [m for m in body.get("messages", []) if m.get("role") == "user"]
        user_query = user_messages[-1]["content"] if user_messages else ""
        knowledge_context = _get_project_knowledge_context(project_id, query=user_query) or None

    tools_summary = _get_tools_summary() or None

    steering_context = None
    if project_id:
        try:
            from services.steering import get_steering_context
            steering_context = get_steering_context(project_id) or None
        except Exception:
            pass

    # ── Pre-match tools and execute ──────────────────────────────────
    tool_data = None
    user_messages = [m for m in body.get("messages", []) if m.get("role") == "user"]
    last_user_msg = user_messages[-1]["content"] if user_messages else ""
    pre_matches = _pre_match_tools(last_user_msg)
    if pre_matches:
        log.info("Pre-matched tools: %s", [(n, p) for n, p in pre_matches])

    if pre_matches:
        tool_data_parts = []
        for t_name, t_params in pre_matches:
            result = await asyncio.to_thread(_execute_tool, t_name, t_params)
            if result.get("result"):
                tool_data_parts.append(
                    f"[Tool data — {t_name}({', '.join(f'{k}={v}' for k, v in t_params.items())})]\n"
                    f"{json.dumps(result['result'], indent=2)}"
                )

        if tool_data_parts:
            tool_data = (
                "\n\n--- LIVE TOOL DATA (real-time, use this to answer) ---\n"
                + "\n\n".join(tool_data_parts)
                + "\n--- END TOOL DATA ---"
            )

    # ── Assemble system prompt (single clean call) ───────────────────
    messages = body.get("messages", [])
    build_system_prompt(
        messages,
        memory_context=memory_context,
        steering_context=steering_context,
        knowledge_context=knowledge_context,
        tools_summary=tools_summary,
        tool_data=tool_data,
    )
    body["messages"] = messages

    return StreamingResponse(
        _chat_with_tool_execution(body, client_host),
        media_type="application/x-ndjson",
    )


@router.post("/api/suggest-followups")
async def suggest_followups(request: Request):
    """Generate follow-up question suggestions based on the conversation."""
    body = await request.json()
    model = body.get("model", _svc_config.FALLBACK_MODEL)
    messages_list = body.get("messages", [])
    if len(messages_list) < 2:
        return {"suggestions": []}

    last_exchange = messages_list[-2:]
    context = "\n".join(f"{m['role']}: {m['content'][:300]}" for m in last_exchange)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{_svc_config.OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": f"Based on this conversation, suggest exactly 3 short follow-up questions the user might ask next. Return ONLY the questions, one per line, no numbering.\n\n{context}",
                }],
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 128},
            })
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            suggestions = [q.strip().strip('"').strip("'") for q in content.strip().split("\n") if q.strip()]
            suggestions = [re.sub(r'^[\d]+[.)\s]+|^[-*]\s+', '', s).strip() for s in suggestions]
            return {"suggestions": suggestions[:3]}
    except Exception:
        return {"suggestions": []}
