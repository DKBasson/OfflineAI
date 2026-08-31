"""
RestrictedPython-based tool code sandbox for OfflineAI.

Layered security approach:
  1. Fast-reject denylist — catches obvious dangerous patterns cheaply
  2. AST-level import analysis — verifies only allowlisted modules are imported
  3. RestrictedPython compilation — blocks attribute access to underscore names,
     prevents exec/eval/compile at the AST level
  4. Subprocess isolation (in services/tools.py) — tool runs in a separate process
     with a minimal environment

This module handles layers 1-3 (static validation).
Layer 4 (subprocess isolation) remains in services/tools.py.
"""

from __future__ import annotations

import ast
import logging
import re
from typing import Tuple

log = logging.getLogger("offlineai.sandbox")

# ── Layer 1: Fast-reject denylist ────────────────────────────────────

BLOCKED_PATTERNS = [
    "os.system", "subprocess", "eval(", "exec(", "__import__",
    "open(", "pathlib", "shutil", "glob",
    "compile(",
    "socket", "requests", "urllib.request", "http.client",
    "pickle", "marshal",
    "ctypes", "cffi",
    "sys.exit", "os.environ",
    "importlib",
]

# ── Layer 2: Import allowlist ────────────────────────────────────────

ALLOWED_MODULES = frozenset({
    # Math and data
    "math", "statistics", "decimal", "fractions",
    # Text and data formats
    "json", "re", "string", "textwrap", "csv", "html",
    # Encoding
    "base64", "hashlib", "hmac",
    # URL parsing (not URL opening)
    "urllib.parse",
    # Collections and iteration
    "collections", "itertools", "functools",
    # Time
    "datetime", "time", "calendar",
    # IO (StringIO/BytesIO only — no file access)
    "io",
    # HTTP (the one allowed network library for tools)
    "httpx",
})

# Modules that are allowed as sub-imports (e.g., "from collections import OrderedDict")
ALLOWED_TOP_LEVEL = frozenset({m.split(".")[0] for m in ALLOWED_MODULES})


def _check_denylist(code: str) -> Tuple[bool, str]:
    """Layer 1: fast string-matching check for obviously dangerous patterns."""
    for pattern in BLOCKED_PATTERNS:
        if pattern in code:
            return False, f"Blocked pattern found: {pattern}"
    return True, ""


def _check_imports(code: str) -> Tuple[bool, str]:
    """Layer 2: parse the AST and verify all imports are from the allowlist."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error in tool code: {e}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top_module = alias.name.split(".")[0]
                if top_module not in ALLOWED_TOP_LEVEL:
                    return False, f"Import not allowed: '{alias.name}'. Allowed modules: {', '.join(sorted(ALLOWED_MODULES))}"

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                top_module = node.module.split(".")[0]
                if top_module not in ALLOWED_TOP_LEVEL:
                    return False, f"Import not allowed: 'from {node.module}'. Allowed modules: {', '.join(sorted(ALLOWED_MODULES))}"

    return True, ""


def _check_restricted_python(code: str) -> Tuple[bool, str]:
    """Layer 3: compile through RestrictedPython to block dangerous AST patterns.
    
    RestrictedPython prevents:
    - Access to _-prefixed attributes (e.g., __builtins__, __class__, _private)
    - Direct use of exec, eval, compile as names
    - Augmented attribute access tricks (getattr with underscore names)
    """
    try:
        from RestrictedPython import compile_restricted_exec, safe_globals
        from RestrictedPython.Eval import default_guarded_getattr
        from RestrictedPython.Guards import (
            guarded_unpack_sequence,
            safer_getattr,
        )
    except ImportError:
        # If RestrictedPython isn't installed, fall back to denylist only
        log.warning("RestrictedPython not installed — falling back to denylist-only validation")
        return True, ""

    try:
        result = compile_restricted_exec(code)
    except Exception as e:
        return False, f"RestrictedPython compilation failed: {e}"

    if result.errors:
        errors = "; ".join(str(e) for e in result.errors)
        return False, f"RestrictedPython rejected code: {errors}"

    # Additional check: look for common bypass attempts in the AST
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            # Block getattr/setattr/delattr with string args that start with _
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id in ("getattr", "setattr", "delattr"):
                    if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                        attr_name = str(node.args[1].value)
                        if attr_name.startswith("_"):
                            return False, f"Blocked: {node.func.id}() with underscore attribute '{attr_name}'"

            # Block access to __builtins__, __class__, __dict__, etc.
            if isinstance(node, ast.Attribute):
                if isinstance(node.attr, str) and node.attr.startswith("__") and node.attr.endswith("__"):
                    return False, f"Blocked: access to dunder attribute '{node.attr}'"

    except Exception:
        pass  # AST check is best-effort on top of RestrictedPython

    return True, ""


def validate_tool_code(code: str) -> Tuple[bool, str]:
    """Run all validation layers on tool source code.
    
    Returns (is_valid, error_message). If is_valid is True, error_message is empty.
    
    Validation layers:
      1. Denylist — fast string pattern check
      2. Import allowlist — AST-based import verification
      3. RestrictedPython — AST-level compilation check
    """
    # Layer 1: denylist
    ok, err = _check_denylist(code)
    if not ok:
        return False, err

    # Layer 2: import allowlist
    ok, err = _check_imports(code)
    if not ok:
        return False, err

    # Layer 3: RestrictedPython
    ok, err = _check_restricted_python(code)
    if not ok:
        return False, err

    return True, ""


def get_allowed_modules_list() -> str:
    """Return a formatted string of allowed modules for LLM prompts."""
    return ", ".join(sorted(ALLOWED_MODULES))
