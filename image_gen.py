"""
Diffusers-based local image generation for OfflineAI.

Lazily loads a Stable Diffusion pipeline on first use.
Falls back gracefully if torch/diffusers are not installed.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
from typing import Any

logger = logging.getLogger("offlineai.image_gen")

# ── Lazy / optional imports ──────────────────────────────────────────────────

_DIFFUSERS_AVAILABLE = False
_IMPORT_ERROR: str | None = None

try:
    import torch
    from diffusers import AutoPipelineForText2Image  # type: ignore[import-untyped]
    _DIFFUSERS_AVAILABLE = True
except ImportError as exc:
    _IMPORT_ERROR = (
        f"Image generation requires PyTorch and Diffusers. "
        f"Install with: pip install diffusers torch transformers accelerate safetensors  "
        f"(ImportError: {exc})"
    )

# ── Configuration ────────────────────────────────────────────────────────────

DEFAULT_MODEL = "stabilityai/stable-diffusion-xl-turbo"
IMAGE_MODEL = os.environ.get("OFFLINEAI_IMAGE_MODEL", DEFAULT_MODEL)

# ── Pipeline state ───────────────────────────────────────────────────────────

_pipeline: Any = None
_pipeline_lock = asyncio.Lock()
_device: str | None = None
_model_id: str | None = None


def _detect_device() -> str:
    """Pick the best available device: MPS (Apple Silicon) > CUDA > CPU."""
    if not _DIFFUSERS_AVAILABLE:
        return "cpu"
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _load_pipeline_sync() -> Any:
    """Load the diffusion pipeline (blocking — run in a thread)."""
    global _pipeline, _device, _model_id

    device = _detect_device()
    dtype = torch.float16 if device in ("cuda", "mps") else torch.float32

    logger.info("Loading diffusion model %s on %s (dtype=%s)", IMAGE_MODEL, device, dtype)

    pipe = AutoPipelineForText2Image.from_pretrained(
        IMAGE_MODEL,
        torch_dtype=dtype,
        variant="fp16" if dtype == torch.float16 else None,
    )
    pipe = pipe.to(device)

    # Optimizations
    if device == "cuda" and hasattr(pipe, "enable_xformers_memory_efficient_attention"):
        try:
            pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()

    _pipeline = pipe
    _device = device
    _model_id = IMAGE_MODEL
    logger.info("Diffusion model loaded successfully on %s", device)
    return pipe


async def _ensure_pipeline() -> Any:
    """Lazily load the pipeline with an async lock (thread-safe)."""
    global _pipeline
    async with _pipeline_lock:
        if _pipeline is None:
            _pipeline = await asyncio.to_thread(_load_pipeline_sync)
    return _pipeline


def _run_inference(
    pipe: Any,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    negative_prompt: str | None,
    seed: int | None,
) -> str:
    """Run inference synchronously (called via asyncio.to_thread).
    Returns a base64-encoded PNG string."""
    import torch as _torch

    generator = None
    if seed is not None:
        generator = _torch.Generator(device=_device or "cpu")
        # MPS generator must be on CPU
        if _device == "mps":
            generator = _torch.Generator(device="cpu")
        generator.manual_seed(seed)

    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "guidance_scale": 0.0 if steps <= 4 else 7.5,  # SDXL Turbo uses guidance_scale=0
    }
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
    if generator is not None:
        kwargs["generator"] = generator

    result = pipe(**kwargs)
    image = result.images[0]

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def generate_image(
    prompt: str,
    width: int = 768,
    height: int = 768,
    steps: int = 10,
    negative_prompt: str | None = None,
    seed: int | None = None,
) -> str:
    """Generate an image from a text prompt.

    Returns a base64-encoded PNG string.
    Raises RuntimeError if diffusers is not installed.
    """
    if not _DIFFUSERS_AVAILABLE:
        raise RuntimeError(_IMPORT_ERROR)

    pipe = await _ensure_pipeline()
    return await asyncio.to_thread(
        _run_inference, pipe, prompt, width, height, steps, negative_prompt, seed,
    )


def get_status() -> dict[str, Any]:
    """Return status information about the image generation backend."""
    return {
        "available": _DIFFUSERS_AVAILABLE,
        "error": _IMPORT_ERROR if not _DIFFUSERS_AVAILABLE else None,
        "model_loaded": _pipeline is not None,
        "model_id": _model_id,
        "device": _device or _detect_device(),
        "configured_model": IMAGE_MODEL,
    }
