# OfflineAI — Technical Documentation

> **Definitive technical reference for OfflineAI, a local-first AI research workstation.**
>
> Version: current · Last updated: August 2026

---

## Table of Contents

1. [Overview & Philosophy](#1-overview--philosophy)
2. [Architecture](#2-architecture)
3. [Feature Reference](#3-feature-reference)
   - [3.1 Chat & Inference](#31-chat--inference)
   - [3.2 Tools & Plugins](#32-tools--plugins)
   - [3.3 Memory System](#33-memory-system)
   - [3.4 Web Search & Research](#34-web-search--research)
   - [3.5 Research Projects](#35-research-projects)
   - [3.6 Generation & Export](#36-generation--export)
   - [3.6.2 Spec-Driven Code Workflow](#362-spec-driven-code-workflow)
   - [3.6.3 Steering Documents](#363-steering-documents)
   - [3.6.4 Agent Hooks](#364-agent-hooks)
   - [3.7 Image Generation](#37-image-generation)
   - [3.8 Audio & Documents](#38-audio--documents)
   - [3.9 Settings & Configuration](#39-settings--configuration)
   - [3.10 UI Features](#310-ui-features)
   - [3.11 Security](#311-security)
4. [API Reference](#4-api-reference)
5. [Configuration Reference](#5-configuration-reference)
6. [Storage & Data](#6-storage--data)
7. [Security Model](#7-security-model)
8. [Design System](#8-design-system)
9. [Testing](#9-testing)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview & Philosophy

OfflineAI is a **local-first AI research workstation** that runs entirely on your device. No cloud services, no subscriptions, no data leaving your machine.

### Core Principles

- **Privacy by default** — all inference, storage, and processing happen locally. The only outbound network calls are opt-in web searches via DuckDuckGo (no API keys, no accounts).
- **Zero configuration** — one install script sets up everything: Ollama, models, Python environment, and vendored frontend assets.
- **Self-contained** — the entire stack (LLM backend, web server, frontend) runs from a single `start.sh` / `start.bat` command.
- **Extensible** — a plugin system lets the AI build its own tools at runtime. Research projects accumulate persistent knowledge. Memory persists user preferences across sessions.

### What It Does

OfflineAI provides a browser-based chat interface backed by local LLM inference via Ollama. Beyond basic chat, it offers:

- Autonomous multi-step web research with persistent project knowledge
- Document, code, and data generation with PDF export
- Audio transcription, document parsing, and image generation
- A self-building tool/plugin system
- Persistent user memory injected into every conversation
- Full conversation history with search, export, and import

---

## 2. Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                   │
│  React 18 · TypeScript · Vite · Tailwind CSS v3         │
│  IndexedDB + localStorage + sessionStorage              │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────┐
│                 FastAPI + Uvicorn (:8080)                │
│  app.py (146 lines) — composition root                  │
│  services/ (14 modules) · routes/ (10 modules)          │
│  62 endpoints · Middleware: body-size limit · LAN auth   │
└───────┬──────────┬──────────┬──────────┬────────────────┘
        │          │          │          │
   ┌────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼──────────┐
   │ Ollama │ │ ddgs   │ │Whis- │ │ File System  │
   │ :11434 │ │ (DDG)  │ │ per  │ │ ~/OfflineAI- │
   │ LLM +  │ │ Web    │ │ tiny │ │  Projects/   │
   │ Image  │ │ Search │ │      │ │  Plugins/    │
   └────────┘ └────────┘ └──────┘ │  Memory/     │
                                   └──────────────┘
```

### Backend (`app.py` + `services/` + `routes/`)

`app.py` is a 146-line composition root that mounts route modules and wires services. Business logic is split across 15 service modules in `services/`, and HTTP endpoints are organized into 11 route modules in `routes/`:

**Services (14 modules):** `config` (centralised configuration), `tokens` (usage tracking), `system` (health diagnostics), `memory` (user preferences), `projects` (project CRUD and files), `tools` (plugin registry), `research` (two-phase research pipeline), `media` (audio/document processing), `ollama` (Ollama client), `sandbox` (RestrictedPython 3-layer tool sandbox), `queue` (operation queue with `asyncio.Semaphore(1)`), `prompt_assembly` (clean prompt construction), `knowledge_store` (SQLite FTS5 per-project knowledge retrieval), `versions` (artifact version history).

**Routes (10 modules):** `ui` (frontend serving), `models` (model management), `chat` (streaming completions), `tokens` (token tracking), `media` (transcription/extraction/image generation), `projects` (project CRUD/files/knowledge/versions), `generation` (research/document/code/data/workflow), `tools` (build/execute/toggle/preview), `memory` (memory CRUD), `portability` (export/import archive).

The application:

1. **Serves the frontend** — static files from `react-dist/` (Vite build output) and `static/` (vendored highlight.js).
2. **Proxies Ollama** — chat completions, model management, image generation. Injects system-level context (memory, project knowledge, tool summaries) before forwarding to Ollama.
3. **Runs agents** — research agent (multi-step web search → extraction → synthesis), workflow orchestrator, tool builder.
4. **Manages files** — project CRUD, file browser, knowledge base, plugin registry.
5. **Processes media** — audio transcription (faster-whisper), document extraction (python-docx, odfpy, pypdf), image generation.

All streaming endpoints use **Server-Sent Events (SSE)** for real-time progress.

### Frontend (`react-app/`)

A React 18 single-page application built with Vite and TypeScript:

- **State management**: single React Context split into 6 hook slices (`useStreamingSlice`, `useUISlice`, `useHistorySlice`, `useModelsSlice`, `usePromptsSlice`, `useProjectsSlice`) managing 40+ state variables.
- **20+ components**: App, Header, Sidebar, ChatArea, MessageBubble, MessageInput, SettingsPanel (5 tabs), ProjectsPanel, ProjectFileBrowser, WelcomeScreen, NameModal, ShortcutsModal, Lightbox, DragOverlay, MemoryPanel, ToolsPanel, and more.
- **Storage**: IndexedDB (primary), localStorage (settings, prompts, fallback history), sessionStorage (LAN auth token).

### Data Flow — Chat Completion

```
User types message
    │
    ▼
Frontend: intent detection (regex heuristics) → model routing
    │
    ▼
POST /api/chat {model, messages[], user, project_id, options}
    │
    ▼
Backend: inject memory → inject project knowledge → inject tools summary
    │
    ▼
Forward to Ollama /api/chat (streaming)
    │
    ▼
Stream tokens back via SSE → detect tool calls in response
    │                              │
    │                         Tool detected?
    │                         ┌─── Yes ──────────────┐
    │                         │ Execute tool (10s)    │
    │                         │ Feed result to LLM    │
    │                         │ Continue streaming     │
    │                         └───────────────────────┘
    ▼
Frontend: render Markdown, update token count, save to IndexedDB
    │
    ▼
POST /api/suggest-followups → display follow-up pills
```

### Data Flow — Research Agent

```
/research <topic>
    │
    ▼
POST /api/projects/{id}/research {topic, depth}
    │
    ▼
1. LLM generates search queries (3/5/8 based on depth)
    │
    ▼
2. DuckDuckGo search (up to 2 results per query)
    │
    ▼
3. Fetch full page content (up to 5000 chars each)
    │
    ▼
4. LLM extracts structured findings (up to 10 pages, 24000 chars)
    │
    ▼
5. LLM synthesizes Markdown research report
    │
    ▼
6. Save: notes/<topic>.md, generate PDF, update knowledge.json
    │
    ▼
All steps streamed as SSE events to the frontend
```

---

## 3. Feature Reference

### 3.1 Chat & Inference

**Fully offline inference** — all LLM calls run locally via Ollama. No data leaves your machine unless web search is explicitly enabled.

| Feature | Description |
|---|---|
| Streaming responses | Token-by-token streaming via SSE with thinking-dot animation |
| Conversation history | Persisted in browser IndexedDB with full-text search (title, model, message content) |
| System prompts | Create, edit, duplicate, reorder, and set a default. Selected per-conversation via dropdown |
| Per-chat model selection | Choose a different Ollama model for each conversation; persists with the conversation |
| Message editing | Inline edit any user message → Save & Resend regenerates from that point |
| Copy & regenerate | Copy any message to clipboard; regenerate the latest assistant response |
| Follow-up suggestions | After each response, 3 clickable follow-up pills generated by the LLM |
| Error bubbles | Errors render as styled bubbles in the chat flow, not alerts |
| Intent classification | Client-side regex heuristics (20+ image patterns, 15+ code patterns, search patterns) route to specialized models |
| Model routing | Configure separate models for intent detection, text, code, and image tasks in Settings |
| Auto-title | New conversations get an AI-generated title using low temperature for consistency |
| Context auto-scaling | `num_ctx` auto-scales to 32768 when web search or project knowledge is active |
| Markdown rendering | Full Markdown with syntax highlighting (highlight.js), sanitized via DOMPurify |
| Code blocks | Copy and Save buttons on every code block |
| Token counter | Cumulative input/output token display in the header (k/M suffix formatting) |
| Export | Download any conversation as a Markdown file (⌘E) |
| Import | Import conversations from Markdown files via the history sidebar |
| Attachments | Images, text files, audio, and documents via file picker, drag-and-drop, or paste |
| Image support | Attached images displayed as thumbnails; click opens a full-size lightbox |
| Generated images | Displayed inline with captions |

### 3.2 Tools & Plugins

A self-building plugin system that lets the AI create, manage, and invoke tools at runtime.

#### How Tools Work

1. **Building**: describe what you need → the LLM web-searches for APIs, generates a Python module, validates it, test-executes it, and registers it. Up to 3 retries on failure.
2. **Invocation**: tools are matched by keyword overlap before the LLM call. The LLM can also invoke tools mid-response using `<<TOOL:name(params)>>` tags or request new ones with `<<BUILD_TOOL:description>>`.
3. **Execution**: dynamic Python import in a `ThreadPoolExecutor` with a 10-second timeout.
4. **Safety**: generated code passes through a 3-layer sandbox — denylist check, AST import allowlist, and RestrictedPython compilation — before registration.

#### Tool Module Structure

Every tool is a Python file in `~/OfflineAI-Plugins/tools/` that exports:

```python
TOOL_NAME = "my_tool"
TOOL_DESCRIPTION = "What this tool does"
TOOL_PARAMETERS = {"param1": "description", "param2": "description"}

def run(**kwargs):
    """Execute the tool and return a result string."""
    ...
```

#### Tool Lifecycle

| Stage | Detail |
|---|---|
| Storage | `~/OfflineAI-Plugins/tools/` (Python modules), `~/OfflineAI-Plugins/registry.json` (metadata) |
| Auto-disable | 3 consecutive failures → tool is automatically disabled |
| Logging | `~/OfflineAI-Plugins/logs/tool_runs.json` — last 200 execution entries |
| Chat integration | Enabled tools are summarized in the system prompt; execution results are fed back to the LLM |
| Native syntax stripping | DeepSeek-style and generic `<tool_call>` patterns are cleaned from responses |

#### Managing Tools

From **Settings → Tools**:
- **Build a Tool**: enter a description, click Build, watch status updates
- **Installed Tools**: view name, description, usage count, creation date, last used
- **Actions**: test, view source code, enable/disable toggle, delete

### 3.3 Memory System

Persistent user preferences that are automatically injected into every conversation.

| Aspect | Detail |
|---|---|
| Storage | `~/OfflineAI-Memory/preferences.json` |
| Injection | Prepended to system prompt as `"USER PREFERENCES (always follow these)"` |
| Deduplication | Identical text is never added twice |
| Management | Settings → System → Memory panel: add (200 char limit), view list, remove individual entries |
| Scope | Global — applies to all conversations regardless of model or project |

### 3.4 Web Search & Research

#### Web Search

Enable in **Settings → General → Behavior**. When enabled:

- With an **intent model** configured: AI auto-detects when your question needs web data
- Without an intent model: every message triggers a web search
- Results appear as expandable source links on the response

| Detail | Value |
|---|---|
| Provider | DuckDuckGo (via `ddgs` library) — no API keys, no accounts |
| Max results | 5 (default), configurable up to 10 |
| Page fetching | Full page content fetched and cleaned (up to 8000 chars), not just snippets |

#### Autonomous Research Agent

The `/research <topic>` command triggers a multi-step research workflow:

1. **Query generation** — LLM generates diverse search queries based on depth:
   - Quick: 3 queries
   - Standard: 5 queries
   - Deep: 8 queries
2. **Web search** — DuckDuckGo, up to 2 results per query
3. **Page fetching** — full content fetched (up to 5000 chars per page)
4. **Extraction** — LLM extracts structured findings (up to 10 pages, 24000 chars combined)
5. **Synthesis** — LLM writes a Markdown research report
6. **Persistence** — saves to `notes/`, generates PDF, updates `knowledge.json`
7. **Streaming** — all progress streamed as SSE events in real time

### 3.5 Research Projects

Project-based organization for research, documents, code, and data.

#### Creating and Using Projects

1. Open the Projects panel (⌘P or folder icon in the header)
2. Click **+ New Project** — provide a name (64 chars max) and optional description (200 chars max)
3. Click a project to set it as **active** (badge shown in the header)
4. With a project active:
   - AI automatically receives all saved research findings as context (knowledge injection)
   - Slash commands become available
   - All generated output saves to `~/OfflineAI-Projects/<project-name>/`

#### Slash Commands

| Command | Description |
|---|---|
| `/research <topic>` | Autonomous multi-step web research |
| `/document <topic>` | Generate a full Markdown report |
| `/code <description>` | Generate a multi-file code project |
| `/data <topic>` | Generate structured data (CSV/JSON) |
| `/workflow <request>` | Chain multiple steps autonomously |

#### Project File Structure

```
~/OfflineAI-Projects/<project-name>/
├── knowledge.json          # Sources, findings, metadata
├── notes/                  # Research summaries (auto-generated)
├── sources/                # Saved source content
└── output/                 # Generated artifacts
    ├── *.md                # Reports and documents
    ├── data/               # CSV/JSON datasets
    └── code/               # Multi-file code projects
```

#### Project File Browser

- Directory-grouped file tree with expand/collapse
- File size display
- View and download files from the UI
- Direct PDF viewing in browser
- File preview modal with content display
- Export Markdown files to PDF
- Knowledge base viewer

### 3.6 Generation & Export

#### Document Generation

`/document <topic>` generates a full Markdown report saved to the project's `output/` directory. Progress is streamed via SSE.

#### Code Generation

`/code <description>` generates a multi-file code project. Files are created with proper directory structure in `output/code/`.

#### Data Generation

`/data <topic>` generates structured datasets in CSV or JSON format, saved to `output/data/`.

#### Workflow System

`/workflow <request>` chains multiple generation steps:

1. LLM plans steps from your natural-language request
2. Valid step types: `research`, `document`, `code`, `data`
3. Steps execute sequentially with SSE progress updates
4. Knowledge accumulates across steps — later steps can reference earlier results

Example: `/workflow Research electric vehicles, write a market analysis report, and generate a comparison table`

#### PDF Export

| Method | Detail |
|---|---|
| Primary | WeasyPrint → styled PDF (A4, professional typography) |
| Fallback | Styled HTML document if WeasyPrint is unavailable |
| Auto-export | PDFs are generated alongside Markdown for research and document outputs |
| Manual | Export any Markdown file via the project file browser |

### 3.6.1 Interactive Code Workflow

A full-cycle coding assistant that plans, generates, and iteratively edits code projects.

#### New Project Flow (`/code <description>`)

1. **Plan phase** — AI asks 2–3 clarifying questions, performs web research on best practices, then generates a Markdown plan document (architecture, tech stack, file structure, implementation steps).
2. **Generate phase** — AI generates all files following the plan, streaming tokens in real time. Files appear in the artifact canvas with click-to-preview and Download All (ZIP).
3. **Edit phase** — User sends messages in the main chat (e.g., "add dark mode" or "fix the API error handling"). AI reads all current project files, applies changes, saves versions, and returns a change summary.

Use `--skip-plan` to skip the planning phase: `/code --skip-plan simple calculator app`.

#### Import Existing Code

Import an existing codebase for AI-assisted editing:

1. Call `POST /api/projects/{id}/code/import` with `{folder_path: "/path/to/your/project"}`.
2. AI scans up to 200 code files (skips `node_modules`, `.git`, `dist`, etc.), copies them into the project directory.
3. AI generates a comprehensive project understanding document (`.code_memory.md`): overview, architecture, tech stack, key components, file map, dependencies, potential improvements.
4. Session becomes active — user can now request changes via chat.

#### Change Planning for Imported Code

Call `POST /api/projects/{id}/code/analyze` with `{request: "add user authentication"}`:

1. AI asks 1–3 clarifying questions about scope and constraints.
2. AI generates a Markdown change plan: files to modify, files to create, implementation steps, risk assessment.
3. After the plan, send regular messages to apply changes (routed through `/code/edit`).

#### Code Session Persistence

Sessions are saved to `.code_session.json` in the project directory and survive server restarts. The session tracks:
- Generated/imported files
- Conversation history (last 20 messages for context continuity)
- Edit history with change summaries
- The project understanding document

| Endpoint | Purpose |
|---|---|
| `POST /code/plan` | Start planning: questions → web research → plan MD |
| `POST /code/generate` | Generate code from approved plan |
| `POST /code/import` | Import existing folder → scan → understand |
| `POST /code/analyze` | Plan changes to imported code |
| `POST /code/edit` | Apply changes with version tracking |
| `GET /code/session` | Get current session state |
| `DELETE /code/session` | Close and delete session |

### 3.6.2 Spec-Driven Code Workflow

The `/code` command implements a structured specification workflow inspired by Kiro's spec-driven development approach. Instead of jumping straight to code generation, the AI produces three specification documents that the user reviews and approves before any code is written.

#### Three-Phase Spec Process

**Phase 1: Requirements (`requirements.md`)**

The AI generates structured requirements using EARS (Easy Approach to Requirements Syntax) notation:

- **User Stories** — `As a [role], I want [functionality], so that [benefit]`
- **Acceptance Criteria** — Using EARS patterns:
  - `WHEN [event] THEN the system SHALL [response]`
  - `IF [condition] THEN the system SHALL [behavior]`
  - `WHILE [ongoing condition] the system SHALL [continuous behavior]`
  - `WHERE [context] the system SHALL [contextual behavior]`
- **Non-Functional Requirements** — Performance, security, usability
- **Constraints & Assumptions** — Technical and business constraints
- **Success Criteria** — Measurable outcomes

**Phase 2: Design (`design.md`)**

Generated after requirements are approved:

- Architecture overview and component relationships
- Technology stack table (Layer | Technology | Purpose)
- Component interfaces (Input/Output/Dependencies)
- Data models with validation rules
- API endpoint specifications
- Security considerations
- Error handling strategy

**Phase 3: Tasks (`tasks.md`)**

Generated after design is approved:

- Phased implementation plan (Foundation → Core Logic → API → UI → Integration → Deployment)
- Checkbox tasks: `- [ ] 1. Task title`
- Subtasks with specific deliverables
- Requirement traceability: `_Requirements: [X.X]_`
- Testing integrated into each task

#### Approval Flow

```
/code <description>
    ↓
Requirements → [Review & Approve] → Design → [Review & Approve] → Tasks → [Review & Approve] → Execute
```

The ArtifactCanvas shows a progress bar: `✓ Requirements → ✓ Design → ● Tasks → ○ Ready`

At each `_review` phase, an "Approve & Continue" button appears. Users can edit the spec document before approving.

#### Task Execution

After all three phases are approved, the "Execute All Tasks" button runs tasks sequentially:
- Each task streams code generation in real-time
- Files are created/modified with automatic version tracking
- Checkboxes update as tasks complete
- Hooks fire automatically after file changes

#### Session Persistence

Spec sessions are stored in `.code_session.json` within the project directory. They survive server restarts. The "📋 Resume Spec" button in the Projects panel lets users return to an in-progress spec at any time.

### 3.6.3 Steering Documents

Steering documents provide persistent project context that improves all AI interactions.

#### What They Are

Three Markdown files stored in `<project>/.steering/`:

| Document | Contents |
|---|---|
| `product.md` | What the project does, target users, key features, business value, user workflows |
| `tech.md` | Technology stack, patterns & conventions, development standards, dependencies |
| `structure.md` | Architecture overview, directory structure, key components, entry points, data storage |

#### How They're Generated

- **Automatically on code import** — when you import an existing codebase via `/code import <path>`, steering docs are generated from the scan results
- **Manually via the Projects panel** — click the "📋 Steering" button to generate steering docs for any project
- **Via slash command** — `/steering generate` in the chat

#### How They're Used

Steering context is automatically injected into:
- Every chat message when a project is active
- Spec generation (requirements, design, tasks)
- Code generation and editing
- Hook execution

The context appears as a `--- PROJECT STEERING CONTEXT ---` block in the system prompt.

#### Editing

Steering docs appear in the project file browser and can be:
- Viewed in the ArtifactCanvas
- Edited directly
- Updated via the `PUT /api/projects/{id}/steering/{doc}` endpoint

### 3.6.4 Agent Hooks

Hooks are event-driven automations that trigger actions when specific events occur during code development.

#### Creating Hooks

From the Projects panel → 🔗 Hooks:
1. Name: descriptive name (e.g., "Update component tests")
2. Event type: `file_saved`, `file_created`, `file_deleted`, `task_completed`, or `manual`
3. File pattern: glob pattern (e.g., `src/**/*.tsx`)
4. Instructions: natural language description of what should happen

The AI converts instructions into an optimized system prompt for efficient execution.

#### How They Work

1. A file event occurs (e.g., a React component is saved during code editing)
2. The system evaluates all enabled hooks, matching event type and file pattern
3. Matching hooks execute in the background (non-blocking)
4. The hook's system prompt + trigger context are sent to the LLM
5. Results are logged in the hook's run history

#### Hook Storage

Hooks are stored in `<project>/.hooks/hooks.json` with:
- Hook definitions (name, event type, pattern, instructions, system prompt)
- Run history (last 10 executions with timing and success/failure)
- Enable/disable state

#### Examples

| Hook | Event | Pattern | Instructions |
|---|---|---|---|
| Update tests | `file_saved` | `src/**/*.tsx` | When a React component is saved, update its corresponding test file |
| Validate standards | `file_created` | `**/*.py` | Check new Python files follow PEP 8 and project conventions |
| Update README | `file_saved` | `routes/*.py` | When an API route file changes, update the API section of README.md |
| Security scan | `task_completed` | — | After a task completes, scan generated files for security issues |

### 3.7 Image Generation

Local image generation via a diffusion model proxied through Ollama.

| Setting | Default | Range |
|---|---|---|
| Model | `x/z-image-turbo` (~5 GB) | Any Ollama image model |
| Width | 640 px | 256–1024 px |
| Height | 640 px | 256–1024 px |
| Steps | 6 | 2–16 |
| Timeout | 300 seconds | — |

#### Performance Profiles

Configurable in **Settings → Models → Image Generation**:

| Profile | Description |
|---|---|
| Eco | Fastest, lower quality, fewer steps |
| Balanced | Default trade-off |
| Quality | Slowest, highest quality, maximum steps |

Enable/disable image generation in **Settings → General → Behavior**. The AI detects image generation requests via intent classification (20+ regex patterns).

### 3.8 Audio & Documents

#### Audio Transcription

Upload audio files and get text transcription via faster-whisper (local Whisper model).

| Detail | Value |
|---|---|
| Engine | faster-whisper (CPU only, int8 compute) |
| Default model | `tiny` (~75 MB) |
| Configurable model | `WHISPER_MODEL` environment variable |
| Supported formats | mp3, wav, ogg, opus, m4a, webm, flac, aac, wma, aiff, alac (11 formats) |
| Streaming | SSE with progress percentage |
| Initialization | Thread-safe lazy init on first use |

#### Document Parsing

Attach documents directly in chat — text is extracted and sent to the LLM.

| Format | Library | Notes |
|---|---|---|
| `.docx` | python-docx | Word documents |
| `.odt` | odfpy | OpenDocument Text |
| `.ods` | odfpy | OpenDocument Spreadsheet |
| `.odp` | odfpy | OpenDocument Presentation |
| `.pdf` | pypdf | PDF documents |

- Extraction runs in background threads with temp file cleanup
- Graceful 501 response if a required library is not installed

### 3.9 Settings & Configuration

The Settings panel slides in from the right and has 5 tabs:

#### General Tab

| Setting | Range | Default | Description |
|---|---|---|---|
| Profile name | 1–32 chars | — | Display name (set on first launch) |
| Context messages | 4–100 | — | How many messages sent as context |
| Temperature | 0–2 | — | Sampling temperature |
| Top P | 0.1–1 | — | Nucleus sampling |
| Max reply tokens | 0–8192 | — | Maximum tokens in response |
| Context tokens (num_ctx) | 0–32768 | — | Model context window |
| Auto-title | toggle | on | AI-generated conversation titles |
| Web search | toggle | off | Enable DuckDuckGo web search |
| Image generation | toggle | — | Enable local image generation |

All settings include info tooltips explaining their effect.

#### Models Tab

- **Download model**: pull new Ollama models by name
- **Available models**: list of installed models
- **Model routing**: configure separate models for intent detection, text generation, and code generation
- **Image generation**: select image model, choose performance profile (eco/balanced/quality), download image model

#### Prompts Tab

- List of system prompts with star-default indicator
- Reorder via drag or buttons
- Duplicate, edit, and delete prompts
- Add new prompts via inline form
- Default prompt auto-applied to new conversations

#### System Tab

- **Memory panel**: add, view, and remove persistent user preferences
- **Runtime health**: Ollama status, chat model, total models count, vision support, access mode, history storage type
- **Actions**: restart Ollama, reset token counter (localhost only)
- **History**: saved conversations limit (10–200), clear all history (danger zone with confirmation)

#### Tools Tab

- **Build a Tool**: description input + build button with live status
- **Installed Tools**: name, description, usage count, created date, last used date
- **Tool actions**: test execution, view source code, enable/disable toggle, delete

### 3.10 UI Features

#### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `⌘/Ctrl+K` | New chat |
| `⌘/Ctrl+L` | Toggle history sidebar |
| `⌘/Ctrl+P` | Toggle projects panel |
| `⌘/Ctrl+E` | Export conversation as Markdown |
| `⌘/Ctrl+/` | Focus message input |
| `⌘/Ctrl+Shift+F` | Toggle focus mode (hides header) |
| `⌘/Ctrl+F` | In-chat search |
| `?` | Show keyboard shortcuts modal |
| `Escape` | Close modals, panels, and search |

The shortcuts modal auto-detects Mac vs. Windows and shows the appropriate modifier keys.

#### Welcome Screen

Displayed when no messages are present:

- Animated breathing glyph
- Personalized greeting with user name
- Active model display
- 5 conversation templates: Code Review, Summarize, Brainstorm, Explain Like I'm 5, Debug Helper

#### History Sidebar

- Full-text search across title, model, and message content
- Load and continue previous conversations
- Delete conversations
- Import conversations from Markdown files
- Empty state messaging

#### In-Chat Search

`⌘/Ctrl+F` opens an in-chat search bar:
- Matches highlighted; non-matching messages dimmed
- Real-time filtering as you type
- Escape to close

#### Message Features

| Feature | Description |
|---|---|
| User avatar | First letter of display name |
| Assistant avatar | ⚡ lightning bolt |
| Intent badge | Shows detected intent (code/image/search/text) and which model was used |
| Timestamps | Displayed on each message |
| Token count | Per-message token usage |
| Search sources | Expandable list of web search results with links |
| Generated files | PDF view and download buttons for generated artifacts |
| Tool call cleaning | Raw tool-call artifacts stripped from rendered messages |

#### Attachments

- Click the 📎 button, drag-and-drop onto the chat, or paste from clipboard
- Image attachments: normalized to PNG, displayed as thumbnails, click for lightbox
- Text files: content read inline and included in message
- Documents: text extracted via parsing libraries
- Audio: transcribed via Whisper and text included in message
- Dynamic file-type accept list based on whether the active model supports vision

#### Focus Mode

`⌘/Ctrl+Shift+F` toggles focus mode, which hides the header for a distraction-free experience.

#### Connection Status

The ConnectionPill in the header shows real-time Ollama status:

| State | Indicator |
|---|---|
| Checking | Shimmer animation |
| Online | Green dot |
| Offline | Red dot |
| LAN mode | Detected and displayed |

Polled every 30 seconds.

### 3.11 Security

See [Section 7: Security Model](#7-security-model) for the complete security reference.

Summary of security features:
- LAN token authentication for non-localhost access
- 50 MB request body size limit
- Path traversal prevention on all project file operations
- RestrictedPython 3-layer tool sandbox (denylist + AST import allowlist + RestrictedPython compilation)
- Localhost-only restriction on runtime control endpoints
- No analytics or telemetry
- No CDN at runtime — highlight.js vendored locally

---

## 4. API Reference

All endpoints are served by the FastAPI backend at the configured host and port (default `http://127.0.0.1:8080`).

### 4.1 Frontend & Static

| Method | Path | Description |
|---|---|---|
| GET | `/` | Serves the React frontend from `react-dist/index.html`. Falls back to a minimal built-in page if the build directory is missing. |

### 4.2 Chat & Models

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/models` | — | Returns a list of all available Ollama models. |
| GET | `/api/status` | — | Returns Ollama connection status, LAN mode flag, and auth information. |
| GET | `/api/health` | — | Returns full system health diagnostics including Ollama status, available models, RAM usage, disk space, and service states. |
| POST | `/api/chat` | `model` (string), `messages` (array), `user` (string), `project_id` (string, optional), `options` (object: `temperature`, `top_p`, `num_predict`, `num_ctx`, etc.) | Streams a chat completion via SSE. Injects user memory, project knowledge (if `project_id` provided), and enabled tools summary into the system prompt. Detects and executes tool calls mid-stream. |
| POST | `/api/show` | `model` (string) | Proxies to Ollama's model detail endpoint. Returns model metadata, parameters, and template. |
| POST | `/api/pull` | `name` (string) | Pulls/downloads a model from the Ollama registry. Streams NDJSON progress events. |
| POST | `/api/ollama/restart` | — | Kills the running Ollama process and restarts it. **Localhost-only** — rejected from non-loopback addresses unless a valid LAN token is provided. Respects `OLLAMA_RESTART_CMD` if set. |

### 4.3 Token Tracking

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/tokens` | — | Returns per-user token usage statistics from `token_stats.json`. |
| DELETE | `/api/tokens` | `user` (query param) | Resets token counts for the specified user. |

### 4.4 Web Search

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/search` | `query` (string), `max_results` (int, default 5, max 10) | Searches DuckDuckGo and returns results with titles, URLs, and snippets. |
| POST | `/api/fetch-page` | `url` (string), `max_chars` (int, default 8000) | Fetches the URL, strips HTML tags, and returns clean text content. |

### 4.5 Media

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/transcribe` | Audio file (multipart form) | Transcribes audio via faster-whisper. Returns SSE stream with progress percentage and final transcript. Supports: mp3, wav, ogg, opus, m4a, webm, flac, aac, wma, aiff, alac. |
| POST | `/api/extract` | Document file (multipart form) | Extracts text from documents. Supports: .docx, .odt, .ods, .odp, .pdf. Returns 501 if the required parsing library is not installed. |
| POST | `/api/generate-image` | `prompt` (string), `model` (string), `width` (int), `height` (int), `steps` (int) | Generates an image via the Ollama image model. Dimensions clamped to [256, MAX], steps clamped to [2, MAX]. 300-second timeout. Returns base64-encoded image data. |

### 4.6 Research Projects

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/projects` | — | Lists all projects with metadata. |
| POST | `/api/projects` | `name` (string, max 64 chars), `description` (string, max 200 chars, optional) | Creates a new project directory at `~/OfflineAI-Projects/<name>/`. |
| GET | `/api/projects/{id}` | — | Returns project metadata including name, description, creation date, and file counts. |
| DELETE | `/api/projects/{id}` | — | Deletes the project and all its files. |
| PUT | `/api/projects/{id}` | `name` (string, optional), `description` (string, optional) | Renames or updates a project's metadata. |
| GET | `/api/projects/{id}/files` | — | Returns a recursive listing of all files in the project with sizes. |
| GET | `/api/projects/{id}/files/{path}` | — | Reads and returns the content of a project file. Path traversal prevented. |
| POST | `/api/projects/{id}/files/{path}` | `content` (string) | Writes content to a file in the project. Creates parent directories as needed. |
| DELETE | `/api/projects/{id}/files/{path}` | — | Deletes a file from the project. |
| POST | `/api/projects/{id}/files/move` | `source` (string), `destination` (string) | Moves or renames a file within the project. Path traversal prevented. |
| GET | `/api/projects/{id}/files/{path}/versions` | — | Lists version history for a file (up to 5 versions stored in `.versions/`). |
| GET | `/api/projects/{id}/files/{path}/versions/{version}` | — | Retrieves a specific version of a file. |
| POST | `/api/projects/{id}/files/{path}/restore/{version}` | — | Restores a file to a previous version. |
| GET | `/api/projects/{id}/download/{path}` | — | Returns the file as a download (Content-Disposition: attachment). |
| GET | `/api/projects/{id}/view/{path}` | — | Serves the file inline for browser viewing (e.g., PDFs). |
| GET | `/api/projects/{id}/knowledge` | — | Returns the project's `knowledge.json` — accumulated research sources, findings, and metadata. |

### 4.7 Generation

All generation endpoints stream progress via SSE and require an active project.

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/projects/{id}/research` | `topic` (string), `depth` (string: quick/standard/deep) | Autonomous multi-step research: generates queries → searches → fetches pages → extracts findings → synthesizes report. Saves to `notes/`, generates PDF, updates `knowledge.json`. |
| POST | `/api/projects/{id}/research/plan` | `topic` (string), `depth` (string: quick/standard/deep) | Generates a research query plan for review before execution. Returns planned queries and estimated scope without running them. |
| POST | `/api/projects/{id}/research/execute` | `plan` (object — approved query plan) | Executes a previously approved research plan. Searches, fetches, extracts, and synthesizes. Saves results and streams progress via SSE. |
| POST | `/api/projects/{id}/generate-document` | `topic` (string), `model` (string, optional) | Generates a full Markdown document/report. Saves to `output/`. |
| POST | `/api/projects/{id}/generate-code` | `description` (string), `model` (string, optional) | Generates a multi-file code project. Saves to `output/code/`. |
| POST | `/api/projects/{id}/generate-data` | `topic` (string), `format` (string: csv/json, optional) | Generates structured data. Saves to `output/data/`. |
| POST | `/api/projects/{id}/export-pdf` | `markdown` (string) or `path` (string) | Exports Markdown content to PDF (via WeasyPrint) or styled HTML (fallback). |
| POST | `/api/projects/{id}/export-docx` | `markdown` (string) or `path` (string) | Exports Markdown content to a DOCX document via python-docx with heading, list, code, and blockquote parsing. |
| POST | `/api/projects/{id}/export-html` | `markdown` (string) or `path` (string) | Exports Markdown content to a standalone HTML document with embedded CSS and dark mode. |
| POST | `/api/projects/{id}/workflow` | `request` (string) | LLM plans and executes a multi-step workflow. Valid step types: research, document, code, data. Steps run sequentially; knowledge accumulates across steps. |

### 4.8 Tools (Plugin System)

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/tools` | — | Lists all registered tools with metadata (name, description, enabled status, usage count, creation date). |
| GET | `/api/tools/{name}` | — | Returns full tool details including source code. |
| POST | `/api/tools/{name}/execute` | `params` (object) | Manually executes a tool with the given parameters. 10-second timeout. |
| DELETE | `/api/tools/{name}` | — | Deletes a tool (removes Python module and registry entry). |
| POST | `/api/tools/{name}/toggle` | — | Toggles a tool between enabled and disabled states. |
| POST | `/api/tools/{name}/preview` | — | Returns the tool's source code and a sample invocation without executing it. |
| POST | `/api/tools/build` | `description` (string), `preview` (boolean, optional) | Autonomously builds a new tool: web-searches for relevant APIs, LLM generates Python module, validates code safety, test-executes, registers. Up to 3 retries on failure. When `preview` is true, generates code for review without registering. |

### 4.9 Memory

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/memory` | — | Returns all saved memory entries. |
| POST | `/api/memory` | `text` (string, max 200 chars) | Adds a memory entry. Deduplication prevents identical entries. |
| DELETE | `/api/memory/{index}` | — | Removes the memory entry at the specified index. |

### 4.10 Follow-ups

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/suggest-followups` | `messages` (array), `model` (string) | Generates 3 contextual follow-up question suggestions based on the conversation. |

### 4.11 Queue

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/queue/status` | — | Returns the current operation queue status including active and pending operations. |

### 4.12 Data Portability

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/export-archive` | — | Exports all projects, plugins, and memory as a downloadable ZIP archive. |
| POST | `/api/import-archive` | ZIP file (multipart form) | Imports a previously exported ZIP archive, merging projects, plugins, and memory with existing data. |

### 4.13 Interactive Code Workflow

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/projects/{id}/code/plan` | `description` (string), `model` (string, optional), `skip_plan` (boolean, default false) | Starts a code planning session. AI asks clarifying questions, researches best practices, then generates a Markdown plan document. Streams SSE with `question`, `token`, `plan`, and `done` events. |
| POST | `/api/projects/{id}/code/generate` | `model` (string, optional), `answers` (string array, optional) | Generates code files from the approved plan. Accepts optional clarification answers. Streams SSE with `status`, `token`, `file`, and `done` events. Creates active code session. |
| POST | `/api/projects/{id}/code/import` | `folder_path` (string), `model` (string, optional) | Imports an existing code folder. Scans up to 200 files (skips node_modules, .git, etc.), copies into project, generates a comprehensive understanding document and steering docs. Streams SSE with `scan`, `token`, `understanding`, and `done` events. |
| POST | `/api/projects/{id}/code/analyze` | `request` (string), `model` (string, optional) | Analyzes imported code for a change request. Asks clarifying questions, generates a Markdown change plan with files to modify, steps, and risk assessment. Streams SSE with `question`, `token`, `plan`, and `done` events. |
| POST | `/api/projects/{id}/code/edit` | `instruction` (string), `model` (string, optional) | Applies code changes. Reads all session files, sends edit instruction to LLM, writes modified files with version tracking, returns structured change summary. Streams SSE with `status`, `token`, `change`, `summary`, and `done` events. |
| GET | `/api/projects/{id}/code/session` | — | Returns the current code session state including status, generated files, conversation history, and edit history. |
| DELETE | `/api/projects/{id}/code/session` | — | Closes and deletes the active code session. |

#### Spec-Driven Endpoints

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/projects/{id}/code/spec` | — | Returns all spec documents (requirements, design, tasks) and the current phase. |
| POST | `/api/projects/{id}/code/spec/approve` | — | Approves the current spec phase and advances to the next phase. |
| POST | `/api/projects/{id}/code/spec/generate` | `model` (string, optional) | Generates the next spec document (design.md or tasks.md) based on the current phase. Streams SSE with `token`, `spec`, and `done` events. |
| POST | `/api/projects/{id}/code/task/execute` | `task_index` (int), `model` (string, optional) | Executes a single implementation task from tasks.md. Streams code generation in real-time with version tracking. Streams SSE with `status`, `token`, `file`, `change`, and `done` events. |

### 4.14 Steering Documents

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/projects/{id}/steering/generate` | `model` (string, optional) | Generates steering documents (product.md, tech.md, structure.md) for the project based on its content and context. Streams SSE with progress events. |
| GET | `/api/projects/{id}/steering` | — | Lists all steering documents for the project. Returns document names and sizes. |
| GET | `/api/projects/{id}/steering/{doc}` | — | Reads and returns the content of a specific steering document. `{doc}` is `product`, `tech`, or `structure`. |
| PUT | `/api/projects/{id}/steering/{doc}` | `content` (string) | Updates a steering document with new content. `{doc}` is `product`, `tech`, or `structure`. |

### 4.15 Agent Hooks

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/projects/{id}/hooks` | — | Lists all hooks for the project with metadata (name, event type, pattern, enabled status, run history). |
| POST | `/api/projects/{id}/hooks` | `name` (string), `event` (string: file_saved/file_created/file_deleted/task_completed/manual), `pattern` (string, glob), `instructions` (string) | Creates a new hook. The AI generates an optimized system prompt from the instructions. |
| PUT | `/api/projects/{id}/hooks/{hookId}` | `name` (string, optional), `event` (string, optional), `pattern` (string, optional), `instructions` (string, optional) | Updates an existing hook's configuration. Regenerates the system prompt if instructions change. |
| DELETE | `/api/projects/{id}/hooks/{hookId}` | — | Deletes a hook. |
| POST | `/api/projects/{id}/hooks/{hookId}/toggle` | — | Toggles a hook between enabled and disabled states. |
| POST | `/api/projects/{id}/hooks/{hookId}/execute` | `context` (object, optional) | Manually triggers a hook with optional context data. Returns execution result and timing. |

---

## 5. Configuration Reference

### 5.1 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint URL. |
| `OFFLINEAI_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN access. |
| `OFFLINEAI_PORT` | `8080` | Web server port. |
| `OFFLINEAI_TOKEN` | Auto-generated in LAN mode | API token required for non-loopback LAN clients. Auto-generated and printed in the terminal when LAN mode is active. Can be set manually. |
| `OLLAMA_RESTART_CMD` | — | Custom command to restart Ollama (e.g., a service manager command). If unset, uses default `ollama serve` workflow. |
| `WHISPER_MODEL` | `tiny` | Whisper model size for audio transcription. Options: tiny (~75 MB), base, small, medium, large. |
| `OFFLINEAI_IMAGE_MAX_WIDTH` | `1024` | Maximum allowed image generation width in pixels. |
| `OFFLINEAI_IMAGE_MAX_HEIGHT` | `1024` | Maximum allowed image generation height in pixels. |
| `OFFLINEAI_IMAGE_MAX_STEPS` | `16` | Maximum allowed diffusion steps. |
| `OFFLINEAI_IMAGE_DEFAULT_WIDTH` | `640` | Default image generation width. |
| `OFFLINEAI_IMAGE_DEFAULT_HEIGHT` | `640` | Default image generation height. |
| `OFFLINEAI_IMAGE_DEFAULT_STEPS` | `6` | Default diffusion steps. |
| `OFFLINEAI_MAX_TOKEN_ENTRIES` | `500` | Maximum entries in `token_stats.json` before pruning. |

### 5.2 Frontend Settings (Browser)

Stored in `localStorage` under `offlineai_settings`:

| Setting | Key | Range | Description |
|---|---|---|---|
| Profile name | `name` | 1–32 chars | User display name |
| Context messages | `contextMessages` | 4–100 | Number of conversation messages included as context |
| Temperature | `temperature` | 0–2 | LLM sampling temperature |
| Top P | `topP` | 0.1–1 | Nucleus sampling probability |
| Max reply tokens | `maxTokens` | 0–8192 | Maximum tokens in LLM response |
| Context tokens | `numCtx` | 0–32768 | Model context window size |
| Auto-title | `autoTitle` | boolean | Generate conversation titles automatically |
| Web search | `webSearch` | boolean | Enable DuckDuckGo web search |
| Image generation | `imageGeneration` | boolean | Enable local image generation |
| Saved conversations limit | `historyLimit` | 10–200 | Maximum stored conversations |
| Intent model | `intentModel` | string | Model used for intent detection |
| Text model | `textModel` | string | Model used for text generation |
| Code model | `codeModel` | string | Model used for code generation |
| Image model | `imageModel` | string | Model used for image generation |
| Image performance profile | `imageProfile` | eco/balanced/quality | Image generation quality vs. speed trade-off |

Settings are normalized with clamping — out-of-range values are automatically adjusted to valid bounds.

### 5.3 Code Constants

```typescript
// react-app/src/constants.ts
export const FALLBACK_MODEL = 'gemma4:e4b';
```

```bash
# scripts/install.sh / scripts/install.bat
MODEL="gemma4:e4b"          # Default chat model (~3.5 GB)
IMAGE_MODEL="x/z-image-turbo"  # Image generation model (~5 GB)
```

Backend constants in `services/config.py`:

| Constant | Value | Description |
|---|---|---|
| `MAX_BODY` | 50 MB (52,428,800 bytes) | Maximum request body size |
| Chat streaming timeout | Varies | Ollama streaming connection timeout |
| Tool execution timeout | 10 seconds | Maximum wall-clock time for tool execution |
| Image generation timeout | 300 seconds | Maximum time for image generation |
| Page fetch max chars | 5000 (research) / 8000 (search) | Max characters fetched from web pages |
| Research max pages | 10 | Max pages processed during extraction |
| Research max chars | 24000 | Max combined characters for extraction |
| Tool log entries | 200 | Max entries in tool execution log |

---

## 6. Storage & Data

### 6.1 File System Storage

| Location | Purpose | Format |
|---|---|---|
| `./token_stats.json` | Cumulative token usage per user | JSON: `{display_name: [prompt_tokens, completion_tokens]}` |
| `~/OfflineAI-Projects/` | Research project files | Directory per project (see [3.5](#35-research-projects)) |
| `~/OfflineAI-Projects/<name>/knowledge.json` | Project knowledge base | JSON: sources, findings, metadata |
| `~/OfflineAI-Plugins/tools/` | Tool Python modules | `.py` files with standard exports |
| `~/OfflineAI-Plugins/registry.json` | Tool registry and metadata | JSON: name, description, enabled, usage count, dates |
| `~/OfflineAI-Plugins/logs/tool_runs.json` | Tool execution log | JSON array, last 200 entries |
| `~/OfflineAI-Memory/preferences.json` | User memory/preferences | JSON array of strings |
| `./static/` | Vendored highlight.js assets | JS + CSS files (generated by installer, gitignored) |
| `./react-dist/` | Built frontend | Vite build output (gitignored) |

### 6.2 Browser Storage

| Mechanism | Key / Database | Purpose | Notes |
|---|---|---|---|
| IndexedDB | `offlineai_history_db` | Primary conversation storage | Full messages, model, timestamps |
| localStorage | `offlineai_settings` | User settings | JSON object |
| localStorage | `offlineai_prompts` | System prompts | JSON array |
| localStorage | `offlineai_history` | Fallback conversation storage | Used if IndexedDB unavailable |
| sessionStorage | `offlineai_auth_token` | LAN authentication token | Cleared when browser tab closes |

### 6.3 Storage Behaviors

- **IndexedDB → localStorage fallback**: if IndexedDB is unavailable (e.g., private browsing in some browsers), conversation history falls back to localStorage.
- **Base64 stripping**: image data (base64) is stripped from messages before saving to history to minimize storage usage.
- **Token stats pruning**: `token_stats.json` is pruned when entries exceed `OFFLINEAI_MAX_TOKEN_ENTRIES` (default 500).
- **Tool auto-disable**: tools with 3 consecutive failures are automatically disabled in the registry.

---

## 7. Security Model

### 7.1 LAN Token Authentication

When OfflineAI is started with `OFFLINEAI_HOST=0.0.0.0` (LAN mode), a token-based authentication system activates:

| Aspect | Detail |
|---|---|
| Token generation | Auto-generated at startup and printed in the terminal. Can be overridden via `OFFLINEAI_TOKEN`. |
| Token delivery | Included as a `token` query parameter in the printed network URL. |
| Token transmission | Via `x-offlineai-token` HTTP header or `token` query parameter. |
| Scope | Applied to all `/api/` routes when LAN mode is active. |
| Loopback bypass | Requests from `127.0.0.1` / `::1` / localhost are always allowed without a token. |
| Frontend storage | Token stored in `sessionStorage` — automatically cleared when the tab closes. |
| Rejection | Unauthorized requests receive a 401 response. |

### 7.2 Request Body Size Limit

All incoming requests are limited to **50 MB** (52,428,800 bytes). Requests exceeding this limit receive a **413 Payload Too Large** response. This applies globally via middleware.

### 7.3 Path Traversal Prevention

All project file operations pass through `_resolve_project_path()`, which:

1. Resolves the requested path against the project's base directory
2. Blocks `..` path components
3. Rejects symlinks that escape the project directory
4. Ensures the resolved path is strictly within `~/OfflineAI-Projects/<project-name>/`

### 7.4 Tool Code Validation

Auto-generated tool code (from the `/api/tools/build` endpoint) is validated through a **3-layer sandbox**:

1. **Denylist check** — code is scanned against a blocklist of dangerous functions and modules.
2. **AST import allowlist** — an AST pass verifies that only explicitly allowed modules are imported.
3. **RestrictedPython compilation** — code is compiled through RestrictedPython, which restricts attribute access, prevents writes to protected names, and limits runtime capabilities.

Blocked patterns in the denylist:

| Blocked Pattern | Risk |
|---|---|
| `os.system` | Arbitrary command execution |
| `subprocess` | Arbitrary process spawning |
| `eval` | Arbitrary code execution |
| `exec` | Arbitrary code execution |
| `__import__` | Dynamic import of blocked modules |
| `open` | Arbitrary file access |
| `pathlib` | File system traversal |
| `shutil` | File operations (copy, move, delete) |
| `glob` | File system enumeration |
| `compile` | Code compilation |

Tools that fail validation are rejected and not registered.

### 7.5 Runtime Control Restriction

The `/api/ollama/restart` endpoint is restricted:

- **Localhost**: always allowed from loopback addresses
- **LAN mode**: requires a valid LAN token
- **Remote**: effectively blocked by the token requirement

### 7.6 Additional Security Measures

| Measure | Detail |
|---|---|
| No CDN at runtime | highlight.js assets are vendored locally during installation with checksum verification |
| No analytics/telemetry | Zero outbound data collection |
| Default localhost binding | Server binds to `127.0.0.1` by default; LAN access is opt-in |
| DOMPurify | All rendered Markdown is sanitized on the frontend |
| Tool execution timeout | 10-second wall-clock limit via ThreadPoolExecutor |
| Tool auto-disable | 3 consecutive failures auto-disable the tool |
| Image dimension clamping | Prevents resource exhaustion from oversized image requests |

---

## 8. Design System

### 8.1 Theme — "iOS 26 Liquid Glass"

A dark, glass-morphism-inspired theme with translucent surfaces and ambient lighting effects.

| Token | Value | Usage |
|---|---|---|
| Background | `#07080f` | Deep black base |
| Ambient halo | Blue radial gradient | Subtle background glow |
| Surface | Translucent with `backdrop-filter: blur()` | Panels, modals, cards |
| Accent | `#8FCAE7` (Pantone 2905 C) | Links, active states, highlights |
| Typography | SF Pro Text / system sans-serif | All text |
| Border | Semi-transparent borders | Glass panel edges |
| Scrollbar | 3px custom width | Minimal scrollbar styling |

### 8.2 CSS Custom Properties

The design system uses CSS custom properties for consistent theming:

- `--surface-*` — translucent surface backgrounds
- `--border-*` — border colors and styles
- `--text-*` — text color hierarchy
- `--accent-*` — accent color variants
- `--status-*` — status indicator colors (online, offline, warning)
- `--radius-*` — border radius tokens
- `--shadow-*` — box shadow definitions

### 8.3 Animations

| Name | Usage | Type |
|---|---|---|
| `msg-in` | New messages appearing | Slide + fade |
| `avatar-glow` | Assistant avatar pulsing | Glow effect |
| `glyph-breathe` | Welcome screen glyph | Scale breathing |
| `think` | Streaming thinking dots | Opacity pulse |
| `cursor-blink` | Text cursor during streaming | Blink |
| `conn-shimmer` | Connection checking state | Shimmer sweep |

### 8.4 Accessibility

OfflineAI implements comprehensive accessibility support:

| Feature | Implementation |
|---|---|
| Modal dialogs | `role="dialog"` + `aria-modal="true"` on all modals (Settings, Shortcuts, Name, Lightbox, file preview) |
| Status indicators | `role="status"` on ConnectionPill for screen reader announcements |
| Navigation | `role="navigation"` on Sidebar |
| Tab interfaces | `role="tablist"` + `aria-selected` on Settings tabs |
| Interactive labels | `aria-label` on all buttons, inputs, and interactive elements |
| Expandable content | `aria-expanded` on expandable search source sections |
| Screen reader text | `.sr-only` CSS class for visually hidden but accessible text |
| Keyboard navigation | Full keyboard access to all features via documented shortcuts |
| Focus management | Visible focus rings on all interactive elements |
| Platform detection | Shortcuts modal shows ⌘ on Mac, Ctrl on Windows |

---

## 9. Testing

OfflineAI has **234 total tests** across three layers.

### 9.1 Backend Tests (pytest)

**71 tests** across 8 test files covering critical backend functionality.

```bash
# Run from project root
python -m pytest
```

| Area | What's Tested |
|---|---|
| UI route (`test_app`) | GET `/` serves the frontend correctly |
| Ollama offline fallback (`test_app`) | Graceful behavior when Ollama is unreachable |
| Body size limits (`test_app`) | 50 MB limit enforced; 413 returned for oversized requests |
| LAN token auth (`test_app`) | Token validation, loopback bypass, rejection without token |
| Restart endpoint (`test_app`) | Localhost-only restriction on `/api/ollama/restart` |
| RestrictedPython sandbox (`test_sandbox`) | 3-layer sandbox: denylist, AST import allowlist, RestrictedPython compilation |
| Operation queue (`test_queue`) | `asyncio.Semaphore(1)` serialization, queue status reporting |
| Prompt assembly (`test_prompt_assembly`) | Memory injection, knowledge injection, tool summary construction |
| Knowledge store (`test_knowledge_store`) | SQLite FTS5 indexing, search, per-project isolation |
| Memory service (`test_memory`) | Add, list, delete, deduplication |
| Project operations (`test_projects`) | CRUD, file operations, rename, move, path traversal prevention |
| Version history (`test_versions`) | Save, list, retrieve, restore, 5-version limit |

### 9.2 React Unit Tests (Vitest)

**~73 tests** across 8 test files covering components and utilities.

```bash
cd react-app && npm test
```

| Area | What's Tested |
|---|---|
| API helpers | Request construction, error handling, response parsing |
| File handling | File type detection, size formatting, attachment processing |
| Markdown rendering | Rendering, sanitization, code block handling |
| Local storage | Settings persistence, fallback behavior, migration |
| MessageBubble | Rendering variants (user, assistant, error, streaming, with attachments) |
| MessageInput | Send behavior, attachment handling, keyboard shortcuts |
| Sidebar | History display, search filtering, conversation loading |
| Modals | Name modal, shortcuts modal — open/close/submit behavior |

### 9.3 End-to-End Tests (Playwright)

**~90 tests** across 17 sections covering full user journeys.

```bash
cd react-app && npm run test:ui
```

> **Note:** The server must be stopped before running E2E tests — Playwright starts its own instance.

| Section | Coverage |
|---|---|
| Smoke | Page loads, key elements present |
| Name modal | Submit, dismiss prevention, Escape lock, 32-char truncation |
| Connection status | Online/offline/LAN states, tooltip |
| Token counter | Starts at 0, k-suffix formatting, visibility |
| Welcome screen | Greeting, model shown, hides/reappears on chat |
| Chat | Send, streaming, empty-input guard, error bubble, copy, regenerate, avatars |
| New chat | Clears messages, resets model |
| Settings panel | All fields, save, defaults, model health, Ollama restart, downloaded models |
| Model selection | Selector present, persists per conversation |
| History sidebar | Open/close, ⌘L toggle, search, load, delete conversations |
| Keyboard shortcuts modal | Open via button/`?`, close via button/Escape/backdrop |
| System prompts | Add, delete, duplicate, star default, edit, appears in selector |
| Model pull | Status messages, Enter key, clears input on success, error state |
| Danger zone | Cancel keeps history, confirm clears history |
| Export | Button visible, ⌘E, click triggers Markdown download |
| Focus mode | ⌘+Shift+F toggles `focus-mode` class on body |
| Keyboard focus shortcuts | ⌘K, ⌘/, ⌘E, ⌘L via keyboard |

---

## 10. Troubleshooting

### Ollama Not Connecting

**Symptoms:** ConnectionPill shows "offline", chat returns errors.

1. Check Ollama is running: `ollama list` in terminal
2. If not running: `ollama serve` or use the Restart Ollama button in Settings
3. Verify the URL: default is `http://localhost:11434`. If using a custom URL, set `OLLAMA_URL`
4. Check the model is pulled: `ollama list` should show your configured model

### Model Not Found

**Symptoms:** "model not found" errors in chat.

1. Open **Settings → Models** to see available models
2. Pull the missing model by name
3. Or change the model selector above the message input to an installed model

### Frontend Not Loading

**Symptoms:** blank page or "fallback" UI.

1. Ensure the frontend has been built: check that `react-dist/` exists and contains files
2. Rebuild: `cd react-app && npm run build`
3. The installer (`scripts/install.sh`) builds the frontend automatically

### LAN Access Not Working

**Symptoms:** other devices can't reach OfflineAI.

1. Start with `OFFLINEAI_HOST=0.0.0.0 ./scripts/start.sh`
2. The terminal will print a network URL with a token — share the full URL
3. Check firewall rules allow incoming connections on the configured port (default 8080)
4. Verify both devices are on the same network

### Audio Transcription Fails

**Symptoms:** transcription errors or 501 responses.

1. Verify faster-whisper is installed: `pip show faster-whisper`
2. Check the Whisper model is downloaded (first use triggers download of ~75 MB for `tiny`)
3. Ensure the audio file is in a supported format (mp3, wav, ogg, opus, m4a, webm, flac, aac, wma, aiff, alac)
4. Check available disk space for temp files

### Document Extraction Returns 501

**Symptoms:** "not implemented" when attaching documents.

The required parsing library is not installed. Install the one you need:

```bash
pip install python-docx   # for .docx
pip install odfpy          # for .odt, .ods, .odp
pip install pypdf          # for .pdf
```

### Image Generation Not Working

**Symptoms:** image generation fails or times out.

1. Ensure image generation is enabled in **Settings → General → Behavior**
2. Verify the image model is pulled: check **Settings → Models → Image Generation**
3. The default model `x/z-image-turbo` is ~5 GB — ensure it's fully downloaded
4. Image generation has a 300-second timeout; complex prompts may take time
5. Check available RAM — image generation is memory-intensive

### PDF Export Produces HTML Instead of PDF

**Symptoms:** you get an HTML file instead of a PDF.

WeasyPrint is not installed or not working. Install it:

```bash
pip install weasyprint
```

On macOS, WeasyPrint requires additional system libraries:

```bash
brew install pango gdk-pixbuf libffi
```

### Token Counter Not Updating

**Symptoms:** token counter stays at 0.

1. Token counting requires a display name — ensure you've set one (Settings → General)
2. Token stats are per-user based on display name
3. Check `token_stats.json` in the project root for data
4. Reset via **Settings → System → Reset Tokens** if the counter seems stuck

### Tools Failing or Auto-Disabled

**Symptoms:** tool returns errors or stops appearing.

1. Check **Settings → Tools** — disabled tools show a toggle
2. Re-enable the tool and test it manually
3. View the source code to check for issues
4. Tools auto-disable after 3 consecutive failures as a safety measure
5. Delete and rebuild the tool if persistent issues occur
6. Check `~/OfflineAI-Plugins/logs/tool_runs.json` for execution logs

### High Memory Usage

**Symptoms:** system slowing down during use.

1. Reduce `num_ctx` (context tokens) in **Settings → General** — lower values use less RAM
2. Use a smaller model (e.g., switch from a 7B to a 3B parameter model)
3. Disable image generation if not needed — unloads the image model from memory
4. Close unused browser tabs — IndexedDB operations can consume memory with large histories

### History Not Saving

**Symptoms:** conversations disappear on refresh.

1. Check that IndexedDB is available (some private browsing modes block it)
2. If IndexedDB is blocked, OfflineAI falls back to localStorage with reduced capacity
3. Check the saved conversations limit in **Settings → System** (default varies, range 10–200)
4. Clear browser storage and reload if the database is corrupted

---

## Appendix: Dependencies

### Python (requirements.txt)

| Package | Version | Purpose |
|---|---|---|
| fastapi | ≥ 0.110.0 | Web framework |
| uvicorn[standard] | ≥ 0.27.0 | ASGI server |
| httpx | ≥ 0.26.0 | Async HTTP client (Ollama proxy, page fetching) |
| aiofiles | ≥ 23.0.0 | Async file I/O |
| pytest | ≥ 8.0.0 | Test framework |
| faster-whisper | ≥ 1.0.0 | Audio transcription |
| python-docx | ≥ 1.1.0 | Word document parsing |
| odfpy | ≥ 1.4.1 | OpenDocument parsing |
| pypdf | ≥ 4.0.0 | PDF parsing |
| ddgs | ≥ 9.0.0 | DuckDuckGo search |
| beautifulsoup4 | ≥ 4.12.0 | HTML parsing |
| lxml | ≥ 5.0.0 | XML/HTML parser backend |
| markdown | ≥ 3.5.0 | Markdown → HTML conversion |
| weasyprint | ≥ 62.0 | PDF generation |

### Frontend (npm)

| Package | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| TypeScript | — | Type safety |
| Vite | — | Build tool and dev server |
| Tailwind CSS | 3 | Utility-first CSS |
| marked.js | 12 | Markdown parsing |
| DOMPurify | 3 | HTML sanitization |
| highlight.js | 11.9 | Syntax highlighting (vendored) |

### System Requirements

| Requirement | macOS | Windows |
|---|---|---|
| OS | macOS (Apple Silicon or Intel) | Windows 10 or 11 |
| Python | 3.10+ (installed by script) | 3.10+ (manual, add to PATH) |
| Ollama | Installed by script via Homebrew | Manual install from ollama.com |
| Disk space | ~20 GB for models | ~20 GB for models |
| Package manager | Homebrew (installed by script) | — |

---

*This documentation covers the complete feature set of OfflineAI as discovered through codebase analysis. For quick-start instructions, see [README.md](README.md).*
