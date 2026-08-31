"""
System prompt assembly for OfflineAI chat.

Replaces the repetitive find-system-message-and-concatenate pattern
with a single clean function that assembles the system prompt from
multiple context sources.
"""

from __future__ import annotations

import logging
from typing import Optional

log = logging.getLogger("offlineai.prompt")


def build_system_prompt(
    messages: list[dict],
    *,
    memory_context: Optional[str] = None,
    steering_context: Optional[str] = None,
    knowledge_context: Optional[str] = None,
    tools_summary: Optional[str] = None,
    tool_data: Optional[str] = None,
) -> list[dict]:
    """Assemble a clean system prompt from multiple context sources.

    Modifies *messages* in place and returns the same list.

    The assembled system message structure:
        {memory_context}

        {user's original system prompt, if any}

        {knowledge_context}

        {tools_summary}

        {tool_data}

    If the user already has a system message, the injected content wraps
    around it. If there is no system message and at least one context
    source is present, a new system message is inserted at position 0.
    """
    # Collect non-empty context parts
    prefix_parts: list[str] = []   # prepended before user's system prompt
    suffix_parts: list[str] = []   # appended after user's system prompt

    if memory_context:
        prefix_parts.append(memory_context)

    if steering_context:
        prefix_parts.append(steering_context)

    if knowledge_context:
        suffix_parts.append(knowledge_context)

    if tools_summary:
        suffix_parts.append(tools_summary)

    if tool_data:
        suffix_parts.append(tool_data)

    # Nothing to inject
    if not prefix_parts and not suffix_parts:
        return messages

    prefix = "\n\n".join(prefix_parts)
    suffix = "\n\n".join(suffix_parts)

    # Find existing system message
    system_idx = next(
        (i for i, m in enumerate(messages) if m.get("role") == "system"),
        None,
    )

    if system_idx is not None:
        original = messages[system_idx]["content"]
        parts = []
        if prefix:
            parts.append(prefix)
        parts.append(original)
        if suffix:
            parts.append(suffix)
        messages[system_idx]["content"] = "\n\n".join(parts)
    else:
        parts = []
        if prefix:
            parts.append(prefix)
        if suffix:
            parts.append(suffix)
        messages.insert(0, {"role": "system", "content": "\n\n".join(parts)})

    return messages
