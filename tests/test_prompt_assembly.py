"""Tests for the system prompt assembly service."""

from services.prompt_assembly import build_system_prompt


def test_no_context_returns_unchanged():
    messages = [{"role": "user", "content": "Hello"}]
    result = build_system_prompt(messages)
    assert len(result) == 1
    assert result[0]["role"] == "user"


def test_memory_only_creates_system_message():
    messages = [{"role": "user", "content": "Hello"}]
    result = build_system_prompt(messages, memory_context="Remember: I prefer dark mode")
    assert len(result) == 2
    assert result[0]["role"] == "system"
    assert "dark mode" in result[0]["content"]


def test_memory_prepended_to_existing_system():
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello"},
    ]
    result = build_system_prompt(messages, memory_context="Remember: I prefer dark mode")
    assert len(result) == 2
    assert result[0]["role"] == "system"
    # Memory should come before the original system prompt
    assert result[0]["content"].startswith("Remember: I prefer dark mode")
    assert "helpful assistant" in result[0]["content"]


def test_knowledge_appended_to_existing_system():
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello"},
    ]
    result = build_system_prompt(messages, knowledge_context="--- PROJECT KNOWLEDGE ---\nFinding 1: ...")
    assert len(result) == 2
    assert result[0]["content"].startswith("You are a helpful assistant.")
    assert "PROJECT KNOWLEDGE" in result[0]["content"]


def test_all_contexts_combined():
    messages = [
        {"role": "system", "content": "You are a researcher."},
        {"role": "user", "content": "What is quantum computing?"},
    ]
    result = build_system_prompt(
        messages,
        memory_context="USER PREFERENCES: formal tone",
        knowledge_context="--- KNOWLEDGE ---\nQuantum bits...",
        tools_summary="--- TOOLS ---\nweather(city)",
        tool_data="--- TOOL DATA ---\nresult: 25°C",
    )
    assert len(result) == 2  # still just 2 messages
    content = result[0]["content"]
    # Memory is prepended
    assert content.index("USER PREFERENCES") < content.index("researcher")
    # Original is in the middle
    assert "researcher" in content
    # Knowledge, tools, and data are appended (in order)
    assert content.index("researcher") < content.index("KNOWLEDGE")
    assert content.index("KNOWLEDGE") < content.index("TOOLS")
    assert content.index("TOOLS") < content.index("TOOL DATA")


def test_no_system_message_creates_one():
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
        {"role": "user", "content": "What's up?"},
    ]
    result = build_system_prompt(
        messages,
        memory_context="User likes Python",
        tools_summary="--- TOOLS ---\ncalculator(expr)",
    )
    assert len(result) == 4  # 3 original + 1 new system
    assert result[0]["role"] == "system"
    assert "User likes Python" in result[0]["content"]
    assert "TOOLS" in result[0]["content"]


def test_empty_strings_ignored():
    messages = [{"role": "user", "content": "Hello"}]
    result = build_system_prompt(
        messages,
        memory_context="",  # empty string is falsy
        knowledge_context=None,
        tools_summary="",
    )
    assert len(result) == 1  # nothing injected
