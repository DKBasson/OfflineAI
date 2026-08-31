"""Tests for the RestrictedPython-based tool sandbox."""

from services.sandbox import validate_tool_code, _check_denylist, _check_imports, _check_restricted_python


# ── Layer 1: Denylist ─────────────────────────────────────────────────

def test_denylist_blocks_os_system():
    ok, err = _check_denylist('os.system("rm -rf /")')
    assert not ok
    assert "os.system" in err


def test_denylist_blocks_subprocess():
    ok, err = _check_denylist('import subprocess')
    assert not ok
    assert "subprocess" in err


def test_denylist_blocks_eval():
    ok, err = _check_denylist('result = eval("1+1")')
    assert not ok
    assert "eval(" in err


def test_denylist_passes_safe_code():
    ok, err = _check_denylist('import math\nresult = math.sqrt(4)')
    assert ok
    assert err == ""


# ── Layer 2: Import allowlist ─────────────────────────────────────────

def test_imports_allows_safe_modules():
    code = "import math\nimport json\nimport re\nfrom datetime import datetime"
    ok, err = _check_imports(code)
    assert ok, f"Should allow safe imports but got: {err}"


def test_imports_allows_httpx():
    code = "import httpx\nresult = httpx.get('http://example.com')"
    ok, err = _check_imports(code)
    assert ok, f"Should allow httpx but got: {err}"


def test_imports_blocks_os():
    code = "import os\nos.listdir('/')"
    ok, err = _check_imports(code)
    assert not ok
    assert "Import not allowed" in err


def test_imports_blocks_sys():
    code = "import sys\nsys.exit(1)"
    ok, err = _check_imports(code)
    assert not ok
    assert "Import not allowed" in err


def test_imports_blocks_subprocess():
    code = "from subprocess import run\nrun(['ls'])"
    ok, err = _check_imports(code)
    assert not ok
    assert "Import not allowed" in err


def test_imports_blocks_socket():
    code = "import socket"
    ok, err = _check_imports(code)
    assert not ok
    assert "Import not allowed" in err


# ── Layer 3: RestrictedPython ─────────────────────────────────────────

def test_restricted_blocks_dunder_access():
    code = "x = {}.__class__.__bases__[0].__subclasses__()"
    ok, err = _check_restricted_python(code)
    assert not ok, "Should block dunder attribute access"


def test_restricted_blocks_getattr_underscore():
    code = "getattr(__builtins__, 'eval')('1+1')"
    ok, err = _check_restricted_python(code)
    assert not ok, "Should block getattr with underscore attributes"


def test_restricted_allows_safe_code():
    code = '''
import math
import json

TOOL_NAME = "test_tool"
TOOL_DESCRIPTION = "A test tool"
TOOL_PARAMETERS = {"x": {"type": "number", "description": "input", "required": True}}

def run(**kwargs):
    x = float(kwargs.get("x", 0))
    return {"result": math.sqrt(x)}
'''
    ok, err = _check_restricted_python(code)
    assert ok, f"Should allow safe code but got: {err}"


# ── Full pipeline: validate_tool_code ─────────────────────────────────

def test_full_validation_safe_tool():
    code = '''
import math
import json

TOOL_NAME = "calculator"
TOOL_DESCRIPTION = "Performs basic calculations"
TOOL_PARAMETERS = {"expression": {"type": "string", "description": "Math expression", "required": True}}

def run(**kwargs):
    expr = kwargs.get("expression", "0")
    try:
        result = eval(expr)  # This should be blocked by denylist
    except Exception:
        result = 0
    return {"result": result}
'''
    ok, err = validate_tool_code(code)
    assert not ok, "Should block eval("
    assert "eval(" in err


def test_full_validation_import_os():
    code = '''
import os

TOOL_NAME = "malicious"
TOOL_DESCRIPTION = "bad tool"
TOOL_PARAMETERS = {}

def run(**kwargs):
    return {"files": os.listdir("/")}
'''
    ok, err = validate_tool_code(code)
    assert not ok, "Should block import os"


def test_full_validation_getattr_bypass():
    """This is the key bypass the old denylist missed."""
    code = '''
import json

TOOL_NAME = "bypass"
TOOL_DESCRIPTION = "bypass attempt"
TOOL_PARAMETERS = {}

def run(**kwargs):
    # This bypasses simple string matching but NOT RestrictedPython
    fn = getattr(__builtins__, "__import__")
    os = fn("os")
    return {"result": os.listdir("/")}
'''
    ok, err = validate_tool_code(code)
    assert not ok, "Should block getattr(__builtins__, ...) bypass"


def test_full_validation_clean_tool():
    code = '''
import json
import math

TOOL_NAME = "converter"
TOOL_DESCRIPTION = "Converts celsius to fahrenheit"
TOOL_PARAMETERS = {"celsius": {"type": "number", "description": "Temperature in Celsius", "required": True}}

def run(**kwargs):
    c = float(kwargs.get("celsius", 0))
    f = c * 9 / 5 + 32
    return {"fahrenheit": f, "celsius": c}
'''
    ok, err = validate_tool_code(code)
    assert ok, f"Clean tool should pass but got: {err}"
