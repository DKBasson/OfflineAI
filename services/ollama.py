import asyncio
import json
import logging
import os
import platform
import shlex
import shutil
import subprocess
import time

import httpx

import services.config as _config
from services.config import FALLBACK_MODEL
from services.system import _ndjson_error
from services.tokens import _tally_done_line, _token_stats, _save_token_stats
from services.tools import (
    _get_tools_summary,
    _parse_tool_calls,
    _strip_tags_for_display,
    _BUILD_TOOL_RE,
    _build_tool,
    _execute_tool,
    _pre_match_tools,
)

log = logging.getLogger("offlineai")


async def _ollama_json_request(method: str, path: str, *, body: dict | None = None, timeout: float = 5.0) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(method, f"{_config.OLLAMA}{path}", json=body)
        response.raise_for_status()
        return response.json()


def _start_ollama_serve() -> tuple[bool, str]:
    ollama = shutil.which("ollama")
    if not ollama:
        return False, "The ollama command was not found on PATH."

    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([ollama, "serve"], **kwargs)
    return True, "ollama serve started"


def _restart_ollama_process() -> dict:
    custom_cmd = os.environ.get("OLLAMA_RESTART_CMD", "").strip()
    if custom_cmd:
        try:
            cmd = shlex.split(custom_cmd)
            if not cmd:
                return {"ok": False, "error": "OLLAMA_RESTART_CMD is empty."}
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()
                return {
                    "ok": False,
                    "error": f"Restart command exited with {proc.returncode}.",
                    "detail": detail,
                    "method": "custom",
                }
            return {"ok": True, "method": "custom"}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "method": "custom"}

    try:
        system = platform.system()
        if system == "Windows":
            taskkill = shutil.which("taskkill")
            if taskkill:
                subprocess.run(
                    [taskkill, "/f", "/im", "ollama.exe"],
                    capture_output=True,
                    text=True,
                    timeout=8,
                    check=False,
                )
        else:
            pkill = shutil.which("pkill")
            killall = shutil.which("killall")
            if pkill:
                subprocess.run([pkill, "-x", "ollama"], capture_output=True, text=True, timeout=8, check=False)
            elif killall:
                subprocess.run([killall, "ollama"], capture_output=True, text=True, timeout=8, check=False)

        time.sleep(0.8)
        started, message = _start_ollama_serve()
        if not started:
            return {"ok": False, "error": message, "method": "ollama serve"}
        return {"ok": True, "message": message, "method": "ollama serve"}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "method": "ollama serve"}


async def _wait_for_ollama_ready(timeout: float = 12.0) -> tuple[bool, str]:
    deadline = time.monotonic() + timeout
    last_error = ""
    async with httpx.AsyncClient(timeout=1.0) as client:
        while time.monotonic() < deadline:
            try:
                resp = await client.get(f"{_config.OLLAMA}/")
                if resp.status_code < 500:
                    return True, ""
                last_error = resp.text
            except Exception as exc:
                last_error = str(exc)
            await asyncio.sleep(0.5)
    return False, last_error


_OOM_PATTERNS = [
    "out of memory", "oom", "alloc", "memory", "cannot allocate",
    "model too large", "not enough memory", "CUDA out of memory",
    "mps backend out of memory", "failed to allocate",
]

_RECOVERY_SUGGESTIONS = [
    "Reduce the context size (num_ctx) in Settings → General",
    "Switch to a smaller model (e.g., gemma3:1b or phi4-mini)",
    "Close other applications to free RAM",
    "Restart Ollama from Settings → System",
]


def _detect_oom_error(error_text: str) -> bool:
    """Check if an error message indicates an out-of-memory condition."""
    lower = error_text.lower()
    return any(pattern in lower for pattern in _OOM_PATTERNS)


def _ndjson_error_with_recovery(message: str) -> bytes:
    """Return an NDJSON error with recovery suggestions for OOM-like errors."""
    payload: dict = {"error": message}
    if _detect_oom_error(message):
        payload["recovery_suggestions"] = _RECOVERY_SUGGESTIONS
        payload["error_type"] = "oom"
    return (json.dumps(payload) + "\n").encode()


async def stream_ollama_response(path: str, body: dict, *, write_timeout: float):
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=None, write=write_timeout, pool=5.0)
        ) as client:
            async with client.stream("POST", f"{_config.OLLAMA}{path}", json=body) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode("utf-8", errors="replace").strip()
                    reason = detail or resp.reason_phrase
                    error_msg = f"Ollama returned {resp.status_code}: {reason}"
                    yield _ndjson_error_with_recovery(error_msg)
                    return
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.ConnectError:
        yield _ndjson_error("Cannot connect to Ollama. Start it with: ollama serve")
    except httpx.ReadError as exc:
        # Connection reset mid-stream — often indicates OOM crash
        error_msg = f"Ollama connection lost during inference: {exc}"
        yield _ndjson_error_with_recovery(error_msg)
    except httpx.HTTPError as exc:
        error_msg = f"Ollama request failed: {exc}"
        yield _ndjson_error_with_recovery(error_msg)
    except Exception as exc:
        yield _ndjson_error_with_recovery(str(exc))


async def _chat_stream_with_token_log(body: dict, client_host: str):
    display_name = body.get("user", "").strip() or client_host
    ollama_body  = {k: v for k, v in body.items() if k != "user"}
    buf = b""
    async for chunk in stream_ollama_response("/api/chat", ollama_body, write_timeout=120.0):
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            _tally_done_line(line, display_name)
        yield chunk
    if buf.strip():
        _tally_done_line(buf, display_name)


async def _chat_with_tool_execution(body: dict, client_host: str):
    """Wrap chat streaming with automatic tool execution and tool building.
    
    Flow:
    1. Buffer the model's full response (don't stream raw tool tags to client)
    2. Strip native tool syntax and display clean text
    3. If <<BUILD_TOOL:...>> found: build the tool, then re-run
    4. If <<TOOL:...>> found: execute tools, send results back to model, stream final answer
    5. If neither: just stream the clean response
    """
    full_response = ""

    async for chunk in _chat_stream_with_token_log(body, client_host):
        for line in chunk.decode("utf-8", errors="replace").split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                content = data.get("message", {}).get("content", "")
                if content:
                    full_response += content
            except (json.JSONDecodeError, AttributeError):
                pass
        yield chunk

    cleaned_response = _strip_tags_for_display(full_response)

    build_requests = _BUILD_TOOL_RE.findall(full_response)
    if build_requests:
        for desc in build_requests:
            msg = f"\n\n---\n\U0001f528 *Building new tool: {desc.strip()}...*\n"
            yield (json.dumps({"message": {"role": "assistant", "content": msg}, "done": False}) + "\n").encode()

            build_result = await _build_tool(desc.strip(), body.get("model", FALLBACK_MODEL))

            if build_result.get("ok"):
                status = f"\u2714 Tool '{build_result['name']}' created and ready to use!\n\n"
            else:
                status = f"\u26a0\ufe0f Could not build tool: {build_result.get('error', 'Unknown error')}\n\n"
            yield (json.dumps({"message": {"role": "assistant", "content": status}, "done": False}) + "\n").encode()

        follow_up = dict(body)
        msgs = list(follow_up.get("messages", []))
        msgs.append({"role": "assistant", "content": cleaned_response})
        msgs.append({"role": "user", "content": "The tools have been built. Now answer the original question using the newly available tools. Use <<TOOL:name(params)>> to call them."})
        follow_up["messages"] = msgs
        tools_summary = _get_tools_summary()
        for m in follow_up["messages"]:
            if m.get("role") == "system":
                m["content"] = m["content"] + "\n\n" + tools_summary
                break

        full_response = ""
        async for chunk in _chat_stream_with_token_log(follow_up, client_host):
            for line in chunk.decode("utf-8", errors="replace").split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        full_response += content
                except (json.JSONDecodeError, AttributeError):
                    pass
            yield chunk

    tool_calls = _parse_tool_calls(full_response)
    if not tool_calls:
        return

    for t_name, t_params in tool_calls:
        params_display = ", ".join(f"{k}={v}" for k, v in t_params.items())
        progress_msg = f"\n\U0001f527 *Running tool: {t_name}({params_display})...*\n"
        yield (json.dumps({"message": {"role": "assistant", "content": progress_msg}, "done": False}) + "\n").encode()

    tool_results = []
    for t_name, t_params in tool_calls:
        result = await asyncio.to_thread(_execute_tool, t_name, t_params)
        tool_results.append({"tool": t_name, "params": t_params, "result": result})
        result_preview = json.dumps(result.get("result", result), indent=2)[:800]
        yield (json.dumps({"message": {"role": "assistant", "content": f"\u2714 {t_name}: {result_preview}\n"}, "done": False}) + "\n").encode()

    results_text = "\n\n".join(
        f"Tool '{tr['tool']}' result: {json.dumps(tr['result'])}" for tr in tool_results
    )

    yield (json.dumps({"message": {"role": "assistant", "content": "\n---\n*Processing results...*\n\n"}, "done": False}) + "\n").encode()

    yield (json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}) + "\n").encode()

    yield b"\n"

    follow_up = dict(body)
    msgs = list(follow_up.get("messages", []))
    msgs.append({"role": "assistant", "content": _strip_tags_for_display(full_response)})
    msgs.append({"role": "user", "content": f"Here are the tool execution results:\n{results_text}\n\nUse these results to provide your final answer. Do NOT include <<TOOL:...>> or <<BUILD_TOOL:...>> tags \u2014 the tools have already been executed. Just give a natural response using the data."})
    follow_up["messages"] = msgs

    async for chunk in _chat_stream_with_token_log(follow_up, client_host):
        yield chunk
