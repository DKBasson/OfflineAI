import asyncio
import os

try:
    from faster_whisper import WhisperModel as _WhisperModel
    _WHISPER_AVAILABLE = True
except ImportError:
    _WHISPER_AVAILABLE = False

try:
    import docx as _docx_module
    _DOCX_AVAILABLE = True
except ImportError:
    _DOCX_AVAILABLE = False

try:
    from odf.opendocument import load as _odf_load
    from odf.teletype import extractText as _odf_extract_text
    from odf import text as _odf_text
    _ODF_AVAILABLE = True
except ImportError:
    _ODF_AVAILABLE = False

try:
    import pypdf as _pypdf
    _PDF_AVAILABLE = True
except ImportError:
    _PDF_AVAILABLE = False

try:
    from bs4 import BeautifulSoup
    _BS4_AVAILABLE = True
except ImportError:
    _BS4_AVAILABLE = False

try:
    import markdown as _markdown_lib
    _MARKDOWN_AVAILABLE = True
except ImportError:
    _MARKDOWN_AVAILABLE = False

try:
    import weasyprint as _weasyprint
    _WEASYPRINT_AVAILABLE = True
except ImportError:
    _WEASYPRINT_AVAILABLE = False

_WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
_whisper_model: object = None
_whisper_lock = asyncio.Lock()


async def _get_whisper() -> object:
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            _whisper_model = await asyncio.to_thread(
                _WhisperModel, _WHISPER_MODEL_SIZE, device="cpu", compute_type="int8"
            )
    return _whisper_model
