import json
import logging
import os
import re
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from services.config import PLUGINS_DIR, FALLBACK_MODEL, OLLAMA

log = logging.getLogger("offlineai")

# ── Registry file ─────────────────────────────────────────────────────

_REGISTRY_FILE = PLUGINS_DIR / "registry.json"
if not _REGISTRY_FILE.exists():
    _REGISTRY_FILE.write_text("[]", encoding="utf-8")

# ── Registry cache ────────────────────────────────────────────────────

_tool_registry_cache: list[dict] | None = None
_tool_registry_mtime: float = 0


def _load_tool_registry() -> list[dict]:
    global _tool_registry_cache, _tool_registry_mtime
    try:
        mtime = _REGISTRY_FILE.stat().st_mtime if _REGISTRY_FILE.exists() else 0
        if _tool_registry_cache is not None and mtime == _tool_registry_mtime:
            return _tool_registry_cache
        data = json.loads(_REGISTRY_FILE.read_text(encoding="utf-8"))
        _tool_registry_cache = data
        _tool_registry_mtime = mtime
        return data
    except Exception:
        return []


def _save_tool_registry(registry: list[dict]) -> None:
    global _tool_registry_cache, _tool_registry_mtime
    _REGISTRY_FILE.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")
    _tool_registry_cache = registry
    _tool_registry_mtime = _REGISTRY_FILE.stat().st_mtime


def _validate_tool_code(code: str) -> tuple[bool, str]:
    """Check tool code using the multi-layer sandbox validator."""
    from services.sandbox import validate_tool_code
    return validate_tool_code(code)


def _execute_tool_sandboxed(tool_name: str, params: dict, timeout: float = 10.0) -> dict:
    """Execute a tool in an isolated subprocess for safety."""
    import sys as _sys

    registry = _load_tool_registry()
    tool_entry = next((t for t in registry if t["name"] == tool_name and t.get("enabled", True)), None)
    if not tool_entry:
        return {"error": f"Tool '{tool_name}' not found or disabled"}

    module_path = PLUGINS_DIR / tool_entry["module"]
    if not module_path.exists():
        return {"error": f"Tool module not found: {tool_entry['module']}"}

    expected_params = tool_entry.get("parameters", {})
    for param_name, param_spec in expected_params.items():
        if param_spec.get("required") and param_name not in params:
            return {"error": f"Missing required parameter: {param_name}"}

    # Build a temporary runner script that imports the tool and calls run()
    runner_code = (
        "import json, sys\n"
        "sys.path.insert(0, '')\n"
        "import importlib.util\n"
        f"spec = importlib.util.spec_from_file_location('tool', {str(module_path)!r})\n"
        "mod = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(mod)\n"
        "if not hasattr(mod, 'run'):\n"
        "    print(json.dumps({'__sandbox_error': 'No run() function'}))\n"
        "    sys.exit(0)\n"
        f"params = json.loads({json.dumps(json.dumps(params))})\n"
        "try:\n"
        "    result = mod.run(**params)\n"
        "    print(json.dumps({'__sandbox_result': result}, default=str))\n"
        "except Exception as e:\n"
        "    print(json.dumps({'__sandbox_error': str(e)}))\n"
    )

    runner_file = None
    try:
        # Write runner to a temp file
        fd, runner_path = tempfile.mkstemp(suffix=".py", prefix="tool_runner_")
        runner_file = runner_path
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(runner_code)

        # Use the same Python interpreter (venv-aware)
        python_exe = _sys.executable

        # Build a minimal environment: inherit only essential vars
        safe_env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            "PYTHONPATH": "",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        # On macOS, DYLD_LIBRARY_PATH may be needed
        if "DYLD_LIBRARY_PATH" in os.environ:
            safe_env["DYLD_LIBRARY_PATH"] = os.environ["DYLD_LIBRARY_PATH"]

        proc = subprocess.run(
            [python_exe, runner_path],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=safe_env,
            cwd=str(PLUGINS_DIR),
        )

        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        if proc.returncode != 0:
            error_msg = stderr or f"Process exited with code {proc.returncode}"
            _increment_tool_failure(tool_name)
            _log_tool_run(tool_name, params, None, error_msg)
            log.warning("Tool %s sandbox failed (exit %d): %s", tool_name, proc.returncode, error_msg)
            return {"error": f"Tool execution failed: {error_msg}"}

        if not stdout:
            _increment_tool_failure(tool_name)
            _log_tool_run(tool_name, params, None, "No output from sandbox")
            return {"error": "Tool produced no output"}

        # Parse the last line of stdout as JSON (tool may print debug info before)
        output_line = stdout.strip().split("\n")[-1]
        try:
            output = json.loads(output_line)
        except json.JSONDecodeError:
            _increment_tool_failure(tool_name)
            _log_tool_run(tool_name, params, None, f"Invalid JSON output: {output_line[:200]}")
            return {"error": f"Tool returned invalid output"}

        if "__sandbox_error" in output:
            _increment_tool_failure(tool_name)
            _log_tool_run(tool_name, params, None, output["__sandbox_error"])
            return {"error": f"Tool execution failed: {output['__sandbox_error']}"}

        result = output.get("__sandbox_result")

        for t in registry:
            if t["name"] == tool_name:
                t["usage_count"] = t.get("usage_count", 0) + 1
                t["last_used"] = datetime.now(timezone.utc).isoformat()
                t["consecutive_failures"] = 0
                break
        _save_tool_registry(registry)
        _log_tool_run(tool_name, params, result, None)
        log.info("Tool %s executed successfully (sandboxed)", tool_name)
        return {"result": result}

    except subprocess.TimeoutExpired:
        _increment_tool_failure(tool_name)
        _log_tool_run(tool_name, params, None, "Timeout")
        log.warning("Tool %s sandbox timed out after %ss", tool_name, timeout)
        return {"error": f"Tool '{tool_name}' timed out after {timeout}s"}
    except Exception as exc:
        _increment_tool_failure(tool_name)
        _log_tool_run(tool_name, params, None, str(exc))
        log.warning("Tool %s sandbox error: %s", tool_name, exc)
        return {"error": f"Sandbox execution failed: {exc}"}
    finally:
        if runner_file and os.path.exists(runner_file):
            os.unlink(runner_file)


def _execute_tool_legacy(tool_name: str, params: dict, timeout: float = 10.0) -> dict:
    """Load and execute a tool in-process (legacy fallback)."""
    import importlib.util
    import concurrent.futures

    registry = _load_tool_registry()
    tool_entry = next((t for t in registry if t["name"] == tool_name and t.get("enabled", True)), None)
    if not tool_entry:
        return {"error": f"Tool '{tool_name}' not found or disabled"}

    module_path = PLUGINS_DIR / tool_entry["module"]
    if not module_path.exists():
        return {"error": f"Tool module not found: {tool_entry['module']}"}

    expected_params = tool_entry.get("parameters", {})
    for param_name, param_spec in expected_params.items():
        if param_spec.get("required") and param_name not in params:
            return {"error": f"Missing required parameter: {param_name}"}

    try:
        spec = importlib.util.spec_from_file_location(f"tool_{tool_name}_{time.time()}", str(module_path))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        if not hasattr(module, "run"):
            return {"error": f"Tool '{tool_name}' has no run() function"}

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(module.run, **params)
            result = future.result(timeout=timeout)

        for t in registry:
            if t["name"] == tool_name:
                t["usage_count"] = t.get("usage_count", 0) + 1
                t["last_used"] = datetime.now(timezone.utc).isoformat()
                t["consecutive_failures"] = 0
                break
        _save_tool_registry(registry)
        _log_tool_run(tool_name, params, result, None)
        log.info("Tool %s executed successfully (legacy)", tool_name)
        return {"result": result}

    except concurrent.futures.TimeoutError:
        _increment_tool_failure(tool_name)
        _log_tool_run(tool_name, params, None, "Timeout")
        log.warning("Tool %s timed out after %ss", tool_name, timeout)
        return {"error": f"Tool '{tool_name}' timed out after {timeout}s"}
    except Exception as exc:
        _increment_tool_failure(tool_name)
        _log_tool_run(tool_name, params, None, str(exc))
        log.warning("Tool %s failed: %s", tool_name, exc)
        return {"error": f"Tool execution failed: {exc}"}


def _execute_tool(tool_name: str, params: dict, timeout: float = 10.0) -> dict:
    """Execute a tool, trying sandboxed subprocess first, falling back to legacy in-process."""
    result = _execute_tool_sandboxed(tool_name, params, timeout)
    if result.get("error", "").startswith("Sandbox execution failed:"):
        log.info("Sandbox failed for %s, falling back to legacy execution", tool_name)
        return _execute_tool_legacy(tool_name, params, timeout)
    return result


def _increment_tool_failure(tool_name: str) -> None:
    """Increment failure counter; auto-disable after 3 consecutive failures."""
    registry = _load_tool_registry()
    for t in registry:
        if t["name"] == tool_name:
            fails = t.get("consecutive_failures", 0) + 1
            t["consecutive_failures"] = fails
            if fails >= 3:
                t["enabled"] = False
                log.warning("Tool %s auto-disabled after %d consecutive failures", tool_name, fails)
            break
    _save_tool_registry(registry)


def _log_tool_run(name: str, params: dict, result, error: str | None) -> None:
    log_file = PLUGINS_DIR / "logs" / "tool_runs.json"
    try:
        logs = json.loads(log_file.read_text(encoding="utf-8")) if log_file.exists() else []
    except Exception:
        logs = []
    logs.append({
        "tool": name,
        "params": {k: str(v)[:100] for k, v in params.items()},
        "result": str(result)[:500] if result else None,
        "error": error,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    logs = logs[-200:]
    try:
        log_file.write_text(json.dumps(logs, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _get_tools_summary() -> str:
    """Format available tools as a string for the system prompt."""
    registry = _load_tool_registry()
    enabled = [t for t in registry if t.get("enabled", True)]
    lines = []
    lines.append("--- AVAILABLE TOOLS ---")
    lines.append("CRITICAL: You have a tool execution system. To call a tool, you MUST use this EXACT syntax:")
    lines.append("<<TOOL:tool_name(param1=value1, param2=value2)>>")
    lines.append("")
    lines.append("RULES:")
    lines.append("- Use ONLY the <<TOOL:...>> syntax. Do NOT use any other tool-calling format.")
    lines.append("- Do NOT use function calling, <|tool_calls|>, or any model-native tool syntax.")
    lines.append("- Do NOT hallucinate or make up data. If you need real data, use a tool.")
    lines.append("- The system will execute the tool and return real results to you.")
    lines.append("")
    if enabled:
        lines.append("Available tools:")
        for t in enabled:
            params_str = ", ".join(
                f"{k}={v.get('type', 'string')}" + (" REQUIRED" if v.get("required") else "")
                for k, v in (t.get("parameters") or {}).items()
            )
            lines.append(f"  • {t['name']}({params_str}) — {t.get('description', '')}")
        lines.append("")
        lines.append("Example: <<TOOL:weather(city=London)>>")
    else:
        lines.append("No tools are currently installed.")
    lines.append("")
    lines.append("If you need external data and no tool above covers it, respond with:")
    lines.append("<<BUILD_TOOL:description of what capability you need>>")
    lines.append("The system will automatically research, build, and register a new tool.")
    lines.append("---")
    return "\n".join(lines)


# ── Tool call parsing ─────────────────────────────────────────────────

_TOOL_CALL_RE = re.compile(r'<<TOOL:(\w+)\(([^>]*?)\)>>')
_BUILD_TOOL_RE = re.compile(r'<<BUILD_TOOL:(.+?)>>')
_ALL_TOOL_TAGS_RE = re.compile(r'<<(?:TOOL:\w+\([^>]*?\)|BUILD_TOOL:.+?)>>')

_NATIVE_TOOL_PATTERNS = [
    re.compile(r'<｜tool▁calls▁begin｜>.*?<｜tool▁calls▁end｜>', re.DOTALL),
    re.compile(r'<｜tool▁outputs▁begin｜>.*?<｜tool▁outputs▁end｜>', re.DOTALL),
    re.compile(r'<\|tool_calls?\|>.*?(?:<\|/tool_calls?\|>|$)', re.DOTALL),
    re.compile(r'<\|tool_outputs?\|>.*?(?:<\|/tool_outputs?\|>|$)', re.DOTALL),
    re.compile(r'<tool_call>.*?</tool_call>', re.DOTALL),
    re.compile(r'<function_call>.*?</function_call>', re.DOTALL),
    re.compile(r'```tool_code.*?```', re.DOTALL),
]


def _strip_native_tool_syntax(text: str) -> str:
    """Remove native model tool-calling markup from response text."""
    cleaned = text
    for pattern in _NATIVE_TOOL_PATTERNS:
        cleaned = pattern.sub('', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned


def _parse_tool_calls(text: str) -> list[tuple[str, dict]]:
    """Parse <<TOOL:name(key=value, key2=value2)>> patterns. Handles quoted values with commas."""
    calls = []
    for match in _TOOL_CALL_RE.finditer(text):
        name = match.group(1)
        params_str = match.group(2).strip()
        params = {}
        if params_str:
            parts = re.split(r',\s*(?=\w+=)', params_str)
            for part in parts:
                if "=" in part:
                    k, v = part.split("=", 1)
                    params[k.strip()] = v.strip().strip("'\"")
        calls.append((name, params))
    return calls


def _strip_tags_for_display(text: str) -> str:
    """Remove <<TOOL:...>>, <<BUILD_TOOL:...>> tags, and native model tool syntax from text."""
    cleaned = _strip_native_tool_syntax(text)
    cleaned = _ALL_TOOL_TAGS_RE.sub('', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned


def _pre_match_tools(user_message: str) -> list[tuple[str, dict]]:
    """Match the user's message against installed tools using keyword analysis.
    
    Returns a list of (tool_name, params) to execute BEFORE sending to the LLM.
    This is the fast path — no LLM call needed, works with any model.
    """
    if not user_message:
        return []
    
    registry = _load_tool_registry()
    enabled = [t for t in registry if t.get("enabled", True)]
    if not enabled:
        return []
    
    msg = user_message.lower().strip()
    matches = []
    
    for tool in enabled:
        name = tool["name"]
        desc = (tool.get("description") or "").lower()
        params = tool.get("parameters", {})
        
        name_words = set(name.replace("_", " ").split())
        desc_words = set(re.findall(r'\b[a-z]{3,}\b', desc))
        tool_keywords = name_words | desc_words
        tool_keywords -= {"get", "current", "any", "for", "the", "and", "from", "with", "using", "conditions"}
        
        msg_words = set(re.findall(r'\b[a-z]{3,}\b', msg))
        overlap = tool_keywords & msg_words
        
        if not overlap:
            continue
        
        extracted_params = {}
        for param_name, param_spec in params.items():
            param_desc = (param_spec.get("description") or "").lower()
            
            if "city" in param_name.lower() or "city" in param_desc or "location" in param_name.lower():
                city_patterns = [
                    r'\b(?:in|for|at|of)\s+([A-Z][a-zA-Z\s]+?)(?:\s+(?:today|now|right now|currently|tonight|tomorrow))?\s*[?.!,]?\s*$',
                    r'\b(?:in|for|at|of)\s+([A-Z][a-zA-Z\s]+?)(?:\s*[?.!,]|$)',
                    r'\b(?:weather|temperature|forecast|climate)\s+(?:in\s+|for\s+|at\s+)?([A-Z][a-zA-Z\s]+?)(?:\s*[?.!,]|$)',
                    r'([A-Z][a-zA-Z\s]+?)\s+(?:weather|temperature|forecast|climate)',
                ]
                for pattern in city_patterns:
                    match = re.search(pattern, user_message)
                    if match:
                        extracted_params[param_name] = match.group(1).strip()
                        break
            
            elif "currency" in param_name.lower() or "currency" in param_desc:
                cur_match = re.search(r'\b([A-Z]{3})\b', user_message)
                if cur_match:
                    extracted_params[param_name] = cur_match.group(1)
            
            elif "symbol" in param_name.lower() or "ticker" in param_name.lower():
                ticker_match = re.search(r'\b([A-Z]{1,5})\b', user_message)
                if ticker_match:
                    extracted_params[param_name] = ticker_match.group(1)
            
            elif param_spec.get("type") == "number":
                num_match = re.search(r'\b(\d+(?:\.\d+)?)\b', user_message)
                if num_match:
                    extracted_params[param_name] = num_match.group(1)
        
        required_params = {k for k, v in params.items() if v.get("required")}
        if required_params and not required_params.issubset(extracted_params.keys()):
            continue
        
        if len(overlap) >= 2 or (len(overlap) == 1 and overlap & name_words):
            matches.append((name, extracted_params))
    
    return matches


async def _build_tool(description: str, model: str) -> dict:
    """Autonomously research, build, test, and register a new tool."""
    from services.research import _generate_search_queries, _do_web_search, _fetch_page_content

    log.info("Building tool: %s", description)
    queries = await _generate_search_queries(f"free API no key required for: {description}", 3, model)
    api_info = []
    for q in queries:
        results = await _do_web_search(q, max_results=3)
        for r in results[:2]:
            page = await _fetch_page_content(r.get("href", ""), max_chars=3000)
            if page:
                api_info.append(page)

    combined_research = "\n\n---\n\n".join(api_info[:5])[:15000]

    tool_prompt = f"""Write a Python tool module for: "{description}"

Research findings about available APIs:
{combined_research}

The module MUST follow this EXACT format:
TOOL_NAME = "short_name"  # lowercase, underscores, GENERIC name (e.g. "weather" not "weather_london")
TOOL_DESCRIPTION = "What this tool does in one sentence"
TOOL_PARAMETERS = {{
    "param_name": {{"type": "string", "description": "What this param is", "required": True}}
}}

def run(**kwargs) -> dict:
    import httpx
    # implementation
    return {{"key": "value"}}

CRITICAL RULES:
- The tool MUST be GENERIC, not specific to one city/item/thing. Use parameters for the variable parts.
- TOOL_NAME must be short and generic: "weather", "stock_price", "currency", NOT "weather_cape_town"
- Use ONLY free APIs that require NO API keys. Strongly prefer: Open-Meteo (weather), exchangerate.host (currency), etc.
- Do NOT use any API that needs a key, token, or registration. If you put "YOUR_API_KEY" anywhere, the tool is BROKEN.
- Only import from: httpx, json, datetime, re, math, urllib.parse, html, csv, collections, time, calendar, decimal, statistics, base64, hashlib, hmac, string, textwrap, io, itertools, functools, fractions
- The run() function MUST accept **kwargs and return a dict
- Handle errors gracefully with try/except, return {{"error": "message"}} on failure
- Do NOT use os, subprocess, eval, exec, open(), pathlib, shutil, glob, importlib, socket, pickle, ctypes
- Do NOT access any __dunder__ attributes or use getattr with underscore names
- Keep it simple and focused on one task
  https://api.open-meteo.com/v1/forecast?latitude=XX&longitude=YY&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code
  Use https://geocoding-api.open-meteo.com/v1/search?name=CITY&count=1 to get lat/lon from city name.

Return ONLY the Python code, no markdown fences, no explanations."""

    fix_prompt = tool_prompt
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": fix_prompt}],
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 4096, "num_ctx": 32768},
                })
                data = resp.json()
                code = data.get("message", {}).get("content", "")

            code = code.strip()
            if code.startswith("```"):
                lines = code.split("\n")
                if lines[-1].strip() == "```":
                    lines = lines[1:-1]
                else:
                    lines = lines[1:]
                code = "\n".join(lines)

            valid, error = _validate_tool_code(code)
            if not valid:
                fix_prompt = f"The previous code had a security issue: {error}. Rewrite the entire tool module without using blocked patterns. Return only Python code."
                continue

            import importlib.util
            temp_path = PLUGINS_DIR / "tools" / "_temp_build.py"
            temp_path.write_text(code, encoding="utf-8")

            spec = importlib.util.spec_from_file_location(f"_temp_build_{time.time()}", str(temp_path))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            tool_name = getattr(module, "TOOL_NAME", None)
            tool_desc = getattr(module, "TOOL_DESCRIPTION", None)
            tool_params = getattr(module, "TOOL_PARAMETERS", {})
            run_fn = getattr(module, "run", None)

            if not tool_name or not run_fn:
                fix_prompt = f"The module is missing TOOL_NAME or run(). Rewrite the complete module. Return only Python code."
                temp_path.unlink(missing_ok=True)
                continue

            try:
                import concurrent.futures
                test_params = {}
                for k, v in tool_params.items():
                    if v.get("type") == "number":
                        test_params[k] = 0
                    else:
                        test_params[k] = "London" if "city" in k.lower() else "test"
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(run_fn, **test_params)
                    test_result = future.result(timeout=10.0)
            except Exception as test_err:
                fix_prompt = f"The tool threw an error during testing with params {test_params}: {test_err}. Fix the run() function. Return only Python code."
                temp_path.unlink(missing_ok=True)
                continue

            final_path = PLUGINS_DIR / "tools" / f"{tool_name}.py"
            temp_path.rename(final_path)

            registry = _load_tool_registry()
            registry = [t for t in registry if t["name"] != tool_name]
            registry.append({
                "name": tool_name,
                "description": tool_desc or description,
                "parameters": tool_params,
                "module": f"tools/{tool_name}.py",
                "created": datetime.now(timezone.utc).isoformat(),
                "usage_count": 0,
                "last_used": None,
                "enabled": True,
                "consecutive_failures": 0,
            })
            _save_tool_registry(registry)
            log.info("Tool %s built successfully", tool_name)
            return {"ok": True, "name": tool_name, "description": tool_desc}

        except Exception as exc:
            fix_prompt = f"Failed to load the module: {exc}. Rewrite the complete tool module. Return only Python code."
            temp_path = PLUGINS_DIR / "tools" / "_temp_build.py"
            temp_path.unlink(missing_ok=True)
            continue

    log.warning("Tool build failed after 3 attempts: %s", description)
    return {"ok": False, "error": "Failed to build tool after 3 attempts"}


async def _build_tool_preview(description: str, model: str) -> dict:
    """Generate tool code for preview without registering or testing it."""
    from services.research import _generate_search_queries, _do_web_search, _fetch_page_content

    log.info("Building tool preview: %s", description)
    queries = await _generate_search_queries(f"free API no key required for: {description}", 3, model)
    api_info = []
    for q in queries:
        results = await _do_web_search(q, max_results=3)
        for r in results[:2]:
            page = await _fetch_page_content(r.get("href", ""), max_chars=3000)
            if page:
                api_info.append(page)

    combined_research = "\n\n---\n\n".join(api_info[:5])[:15000]

    tool_prompt = f"""Write a Python tool module for: "{description}"

Research findings about available APIs:
{combined_research}

The module MUST follow this EXACT format:
TOOL_NAME = "short_name"
TOOL_DESCRIPTION = "What this tool does in one sentence"
TOOL_PARAMETERS = {{
    "param_name": {{"type": "string", "description": "What this param is", "required": True}}
}}

def run(**kwargs) -> dict:
    import httpx
    # implementation
    return {{"key": "value"}}

CRITICAL RULES:
- The tool MUST be GENERIC, not specific to one city/item/thing. Use parameters for the variable parts.
- TOOL_NAME must be short and generic: "weather", "stock_price", "currency"
- Use ONLY free APIs that require NO API keys.
- Only import from: httpx, json, datetime, re, math, urllib.parse, html, csv, collections, time, calendar, decimal, statistics, base64, hashlib, hmac, string, textwrap, io, itertools, functools, fractions
- The run() function MUST accept **kwargs and return a dict
- Handle errors gracefully with try/except, return {{"error": "message"}} on failure
- Do NOT use os, subprocess, eval, exec, open(), pathlib, shutil, glob, importlib, socket, pickle, ctypes
- Do NOT access any __dunder__ attributes or use getattr with underscore names

Return ONLY the Python code, no markdown fences, no explanations."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": tool_prompt}],
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 4096, "num_ctx": 32768},
            })
            data = resp.json()
            code = data.get("message", {}).get("content", "")

        code = code.strip()
        if code.startswith("```"):
            lines = code.split("\n")
            if lines[-1].strip() == "```":
                lines = lines[1:-1]
            else:
                lines = lines[1:]
            code = "\n".join(lines)

        valid, error = _validate_tool_code(code)
        if not valid:
            return {"ok": False, "error": f"Generated code has security issue: {error}", "code": code}

        # Extract metadata from generated code without executing
        name_match = re.search(r'TOOL_NAME\s*=\s*["\']([^"\']+)["\']', code)
        desc_match = re.search(r'TOOL_DESCRIPTION\s*=\s*["\']([^"\']+)["\']', code)
        tool_name = name_match.group(1) if name_match else "unknown"
        tool_desc = desc_match.group(1) if desc_match else description

        return {
            "ok": True,
            "preview": True,
            "name": tool_name,
            "description": tool_desc,
            "code": code,
        }

    except Exception as exc:
        log.warning("Tool preview build failed: %s", exc)
        return {"ok": False, "error": f"Failed to generate tool code: {exc}"}
