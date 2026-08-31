# OfflineAI

A local-first AI research workstation that runs entirely on your device. No cloud, no subscriptions, no data leaving your machine.

Built with [Ollama](https://ollama.com), FastAPI, and a React/TypeScript frontend.

---

## Features

### Chat & Inference
- **Fully offline** — all inference runs locally via Ollama
- **Conversation history** — persisted locally in browser IndexedDB with search and AI-generated titles
- **System prompts** — save, duplicate, reorder, and set a default prompt for new conversations
- **Memory system** — persistent user preferences that carry across conversations, stored server-side and injected into every chat
- **Image & file support** — attach images or text files via picker, drag-and-drop, or paste
- **Image generation** — ask the model to draw or generate an image using a local diffusion model
- **Image performance profiles** — three tiers: Eco (640px, 6 steps), Balanced (768px, 10 steps), Quality (1024px, 16 steps)
- **Natural language image detection** — 20+ regex patterns detect image requests without explicit commands ("draw me a…", "paint a…", etc.)
- **Per-chat model selection** — choose a different Ollama model for each conversation
- **Intent classification & model routing** — optional intent model classifies requests (code/image/text/search) with separate model routing per task type
- **Local tuning controls** — adjust temperature, top-p, reply tokens, model context tokens, and saved chat limit
- **Context auto-scaling** — automatically scales context window to 32 768 tokens when web search or project knowledge is active
- **Markdown rendering** — with syntax highlighting and copy-to-clipboard
- **Code block actions** — Copy and Save buttons on hover over code blocks in chat
- **Follow-up suggestions** — AI suggests 3 follow-up questions after each response, shown as clickable pill buttons
- **Message editing** — edit any user message and resend; the response regenerates from that point
- **In-chat search (⌘F)** — search within the current conversation, highlights matches and dims non-matching messages
- **Export conversations** — download any chat as a Markdown file
- **Import conversations** — import conversations from Markdown files via the history sidebar
- **Conversation templates** — 5 quick-start templates on the welcome screen (Code Review, Summarize, Brainstorm, Explain Like I'm 5, Debug Helper)
- **Message controls** — copy messages and regenerate the latest assistant response
- **Audio transcription** — upload `.mp3`, `.wav`, `.ogg`, `.opus`, `.m4a`, `.webm`, `.flac`, `.aac`, `.wma`, `.aiff`, and `.alac` files via Whisper
- **Document reading** — attach `.docx`, `.odt`, `.ods`, `.odp`, and `.pdf` files
- **Focus mode** — distraction-free chat view toggled with **⌘+Shift+F**

### Web Search & Research
- **Web search** — AI searches the internet via DuckDuckGo for up-to-date information (toggle in Settings)
- **Autonomous research agent** — multi-step web research: generates search queries, fetches pages, extracts findings, synthesizes reports
- **Deep page reading** — fetches and reads full web pages (not just snippets) for thorough research
- **Research saved to disk** — all findings, sources, and summaries persist in project folders

### Research Projects
- **Project-based organization** — create named research projects stored at `~/OfflineAI-Projects/`
- **Project file browser** — browse, preview, and download all project files from the UI
- **File preview modal** — preview project files inline with PDF viewing and export
- **Knowledge injection** — when a project is active, the AI automatically has access to all saved research findings
- **Persistent knowledge base** — sources, key findings, and summaries saved in `knowledge.json`

### Generation
- **Document generation** — generate full Markdown reports with PDF/HTML export
- **PDF export** — WeasyPrint for styled PDF output, with HTML fallback
- **Multi-file code generation** — generate complete code projects with multiple files
- **Structured data generation** — generate CSV and JSON datasets
- **Multi-step workflows** — LLM plans steps from natural language, chains research → document → code → data autonomously

### Spec-Driven Code Workflow
- **Three-phase specs** — `/code` generates structured specifications before writing any code: Requirements (EARS user stories with acceptance criteria) → Design (architecture, components, interfaces, data models) → Tasks (phased implementation plan with requirement traceability)
- **EARS requirements** — user stories with acceptance criteria using EARS notation (WHEN/IF/WHILE/WHERE…THEN…SHALL), non-functional requirements, constraints, and success criteria
- **Technical design** — architecture overview, technology stack table, component interfaces, data models, API endpoint specs, security considerations, error handling
- **Task breakdown** — phased implementation tasks with checkboxes, subtasks linked to requirements (`_Requirements: [X.X]_`), and testing integrated into each task
- **Phase-by-phase approval** — review each spec document before proceeding; edit and reapprove at any stage. Progress bar shows Requirements → Design → Tasks → Ready
- **Task-by-task execution** — execute implementation tasks sequentially with real-time progress; checkboxes update as tasks complete
- **Steering documents** — auto-generated `product.md`, `tech.md`, and `structure.md` provide persistent project context for all AI interactions
- **Agent hooks** — event-driven automations that trigger on file changes or task completion (e.g., "update tests when a component changes", "validate code against standards")
- **Resume specs** — spec sessions persist to disk and survive server restarts; resume from the Projects panel at any time
- **Import existing code** — point to a folder on your machine; AI scans the codebase (up to 200 files), generates understanding document and steering docs, and enters edit mode
- **Iterative editing** — after generation, send messages in the main chat to request changes; AI reads all project files, applies changes, and shows a summary of what changed
- **Version tracking** — every edit saves a version of the previous file state, with up to 5 versions per file
- **Click-to-preview** — click any generated file to preview its content with syntax highlighting
- **Download All (ZIP)** — download the entire generated project as a ZIP file

### Tools / Plugins
- **Custom AI tools** — build tools from natural language descriptions, auto-built using LLM + web research
- **Tool management** — test, enable, disable, and delete tools from the UI
- **Tool code validation** — blocks dangerous patterns (file system access, network calls, etc.) in auto-generated code
- **Auto-disable** — tools that fail 3 times are automatically disabled
- **Tool run logging** — execution history with timing and error details
- **`/build` slash command** — build a new tool without needing an active project

### Infrastructure
- **Model pull** — download new Ollama models directly from the Settings panel
- **Ollama restart** — restart the local Ollama runtime from Settings
- **Cumulative token counter** — tracks total input/output tokens locally and can be reset in Settings
- **Connection status indicator** — live checking/online/offline with LAN mode detection
- **First-launch onboarding** — name modal on first visit, personalizes the experience
- **Auto-title conversations** — AI generates 4-word titles for new conversations
- **Settings tooltips** — contextual help tooltips on all settings fields
- **Keyboard shortcuts** — full keyboard navigation (`?` to see all shortcuts)
- **LAN access** — opt-in serving to devices on your local network
- **LAN token auth** — LAN launch scripts generate a one-time access token automatically
- **iOS 26 Liquid Glass design** — dark theme with glass morphism and Pantone 2905 C accent
- **Full accessibility** — ARIA roles, labels, keyboard navigation, screen reader support
- **No CDN at runtime** — highlight.js assets vendored locally with checksum verification

### Security & Storage
- **IndexedDB with localStorage fallback** — robust storage with automatic fallback
- **LAN token in sessionStorage** — token cleared when browser tab closes
- **Base64 image stripping** — images stripped from saved history to minimise storage use
- **Path traversal prevention** — security for project file operations
- **Request body size limit** — 50 MB limit with 413 response

---

## Requirements

### macOS
- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) (installed automatically if missing)
- Python 3.10+
- ~20 GB free disk space for models

### Windows
- Windows 10 or 11
- [Python 3.10+](https://www.python.org/downloads/) — check **"Add Python to PATH"** during install
- [Ollama for Windows](https://ollama.com/download/windows) — install before running `scripts\install.bat`
- ~20 GB free disk space for models

---

## Quick Start

### macOS / Linux

```bash
# 1. Clone the repo
git clone https://github.com/DKBasson/OfflineAI.git
cd OfflineAI

# 2. Run the installer (one-time setup)
chmod +x scripts/install.sh && ./scripts/install.sh

# 3. Start the app
./scripts/start.sh

# Optional: expose on your LAN
OFFLINEAI_HOST=0.0.0.0 ./scripts/start.sh
```

### Windows

```bat
:: 1. Clone the repo
git clone https://github.com/DKBasson/OfflineAI.git
cd OfflineAI

:: 2. Run the installer (one-time setup — run as a regular user, not Administrator)
scripts\install.bat

:: 3. Start the app
scripts\start.bat

:: Optional: expose on your LAN
set OFFLINEAI_HOST=0.0.0.0
scripts\start.bat
```

> **Windows note:** Ollama must be installed manually first from [ollama.com/download/windows](https://ollama.com/download/windows). The installer will check and prompt you if it is missing.

---

### What the installer does

- Installs Homebrew, Python, and Ollama if not already present *(macOS only)*
- Creates a Python virtual environment and installs dependencies
- Pulls the `gemma4:e4b` chat model (~3.5 GB) and `x/z-image-turbo` image generation model (~5 GB)
- Pre-downloads the Whisper `tiny` model for audio transcription (~75 MB)
- Downloads syntax-highlighting assets to `static/`

After `start.sh` / `start.bat` runs, your browser will open automatically. By default the app only listens on localhost:

```
  Local:    http://127.0.0.1:8080
  Network:  disabled (set OFFLINEAI_HOST=0.0.0.0 to expose)
```

When LAN mode is enabled with `OFFLINEAI_HOST=0.0.0.0`, the terminal also prints the network URL.
That URL includes a `token` query parameter for non-local devices. Localhost remains accessible without a token. Share the full network URL only with devices you trust.

---

## Usage

### General

| Action | How |
|---|---|
| Send message | **Enter** |
| New line in input | **Shift+Enter** |
| New chat | **⌘K** / **Ctrl+K** |
| Toggle history sidebar | **⌘L** / **Ctrl+L** |
| Toggle projects panel | **⌘P** / **Ctrl+P** |
| Export conversation | **⌘E** / **Ctrl+E** |
| Search in chat | **⌘F** / **Ctrl+F** |
| Focus input | **⌘/** / **Ctrl+/** |
| Focus mode | **Shift+⌘F** / **Shift+Ctrl+F** |
| Show all shortcuts | **?** |
| Attach image or file | Click 📎, drag-and-drop, or paste |
| Stop generation | Click the red ■ stop button |
| Search history | Open History and type in the search field |
| Choose model | Use the Model selector above the message box |
| Copy / regenerate | Hover a message and use its action buttons |
| View full-size image | Click any image in the chat |

### Research Projects

1. Press **⌘P** (or click the folder icon in the header) to open the Projects panel
2. Click **+ New Project** — give it a name and optional description
3. Click a project to set it as **active** (shown as a badge in the header)
4. With a project active:
   - The AI automatically has access to all saved research findings
   - Slash commands become available (see below)
   - All generated output saves to `~/OfflineAI-Projects/<project-name>/`

### Slash Commands

When a project is active, type these in the message box:

| Command | What it does |
|---|---|
| `/research <topic>` | Autonomous multi-step web research — searches, reads pages, extracts findings, writes a summary |
| `/document <topic>` | Generates a full Markdown report and saves to the project |
| `/code <description>` | Generates a multi-file code project |
| `/data <topic>` | Generates structured data (CSV) |
| `/workflow <request>` | Chains multiple steps (research → document → code → data) autonomously |

Works without an active project:

| Command | What it does |
|---|---|
| `/build <description>` | Build a custom AI tool from a natural language description |

**Examples:**
```
/research quantum computing breakthroughs 2024
/document comparison of React vs Vue frameworks
/code Python Flask REST API with JWT auth and tests
/data top 20 programming languages by popularity
/workflow Research electric vehicles, write a market analysis report, and generate a comparison table
```

### Web Search

Enable **Web search** in Settings → General → Behavior. When enabled:
- If you have an **intent model** configured, the AI auto-detects when your question needs internet data
- Without an intent model, every message gets a web search when the toggle is on
- Search results are shown as expandable source links on the response

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM backend | [Ollama](https://ollama.com) (`gemma4:e4b`) |
| Web server | [FastAPI](https://fastapi.tiangolo.com) + [uvicorn](https://www.uvicorn.org) |
| HTTP client | [httpx](https://www.python-httpx.org) (async streaming) |
| Web search | [ddgs](https://github.com/deedy5/ddgs) (DuckDuckGo) |
| Page parsing | [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/) + [lxml](https://lxml.de) |
| Frontend | [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org) + [Vite](https://vitejs.dev) |
| Styling | [Tailwind CSS](https://tailwindcss.com) v3 |
| Markdown | [marked.js](https://marked.js.org) v12 |
| Sanitisation | [DOMPurify](https://github.com/cure53/DOMPurify) v3 |
| Syntax highlighting | [highlight.js](https://highlightjs.org) 11.9 |
| Audio transcription | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (Whisper `tiny`) |
| Document parsing | python-docx, odfpy, pypdf |
| PDF export | [markdown](https://python-markdown.github.io/) (HTML conversion) |

---

## Project Structure

```
OfflineAI/
├── app.py              # FastAPI composition root (146 lines — mounts routes, wires services)
├── services/           # Backend service layer (18 modules)
│   ├── config.py           # Centralised configuration and environment variables
│   ├── tokens.py           # Token usage tracking and statistics
│   ├── system.py           # System health and diagnostics
│   ├── memory.py           # Persistent user memory/preferences
│   ├── projects.py         # Research project CRUD and file operations
│   ├── tools.py            # Tool/plugin registry and lifecycle
│   ├── research.py         # Two-phase research pipeline (plan → execute)
│   ├── media.py            # Audio transcription and document extraction
│   ├── ollama.py           # Ollama client and model management
│   ├── sandbox.py          # RestrictedPython 3-layer tool sandbox
│   ├── queue.py            # Operation queue with asyncio.Semaphore(1)
│   ├── prompt_assembly.py  # Clean prompt construction (memory, knowledge, tools)
│   ├── knowledge_store.py  # SQLite FTS5 per-project knowledge retrieval
│   ├── versions.py         # Artifact version history (.versions/, 5-version limit)
│   ├── code_session.py     # Interactive code session management (spec phases, task tracking)
│   ├── steering.py         # Steering document generation and management
│   └── hooks.py            # Event-driven automation hooks
├── routes/             # FastAPI route modules (12 modules)
│   ├── ui.py               # Frontend serving and static files
│   ├── models.py           # Model listing, pull, show, queue status
│   ├── chat.py             # Chat completions (streaming)
│   ├── tokens.py           # Token tracking endpoints
│   ├── media.py            # Transcription, extraction, image generation
│   ├── projects.py         # Project CRUD, files, knowledge, versions
│   ├── generation.py       # Research, document, code, data, workflow generation
│   ├── code.py             # Code import, analysis, and change planning
│   ├── tools.py            # Tool build, execute, toggle, preview
│   ├── memory.py           # Memory CRUD
│   ├── hooks.py            # Project hook management
│   └── portability.py      # Export/import archive
├── requirements.txt    # Python dependencies
├── requirements-dev.txt # Test dependencies (pytest, etc.)
├── token_stats.json    # Persisted token counters (auto-created)
├── scripts/
│   ├── install.sh      # One-time setup (macOS/Linux)
│   ├── start.sh        # Launch script (macOS/Linux)
│   ├── install.bat     # One-time setup (Windows)
│   └── start.bat       # Launch script (Windows)
├── react-app/          # Vite + React + TypeScript source
│   ├── src/
│   │   ├── App.tsx
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── components/     # UI components
│   │   │   ├── ProjectsPanel.tsx
│   │   │   ├── ProjectFileBrowser.tsx
│   │   │   └── ...
│   │   ├── context/        # AppContext (global state)
│   │   │   └── hooks/     # useStreamingSlice, useProjectsSlice, etc.
│   │   └── utils/          # api, storage, markdown, files
│   └── package.json
├── react-dist/         # Vite build output (served by FastAPI, gitignored)
├── static/             # Vendored highlight.js assets (generated by installer, gitignored)
└── tests/              # Backend tests (71 tests across 8 files)
```

### Research Projects folder

When you create projects, they live at:

```
~/OfflineAI-Projects/
└── <project-name>/
    ├── knowledge.json        # Sources, findings, metadata
    ├── .code_session.json    # Active code session state (spec phases, task progress)
    ├── .steering/            # Steering documents (auto-generated)
    │   ├── product.md        # What the project does, users, features
    │   ├── tech.md           # Technology stack, patterns, conventions
    │   └── structure.md      # Architecture, directory layout, components
    ├── .hooks/               # Agent automation hooks
    │   └── hooks.json        # Hook definitions and run history
    ├── specs/                # Spec documents per session
    │   └── <session-id>/
    │       ├── requirements.md
    │       ├── design.md
    │       └── tasks.md
    ├── notes/                # Research summaries (auto-generated)
    ├── sources/              # Saved source content
    └── output/               # Generated documents, code, data
        ├── *.md              # Generated reports
        ├── data/             # CSV/JSON datasets
        └── code/             # Multi-file code projects
```

### Other data directories

```
~/OfflineAI-Plugins/      # Custom AI tools (auto-created when you build tools)
~/OfflineAI-Memory/        # Persistent user preferences (server-side memory system)
```

---

## Configuration

To change the default model, update the constant in `react-app/src/constants.ts` and the model name in the installer:

```ts
// react-app/src/constants.ts
export const FALLBACK_MODEL = 'gemma4:e4b';
```

```bash
# scripts/install.sh / scripts/install.bat
MODEL="gemma4:e4b"
```

Any model available in Ollama can be used. See [ollama.com/library](https://ollama.com/library).  
You can pull new models at runtime from **Settings → Models & context**, then choose the model from the selector above the message box. Each saved conversation keeps its own selected model.

Most runtime preferences live in the browser only under **Settings**. These include generation sampling, model context tokens, auto-title behavior, saved history limit, web search toggle, and token counter reset.

The **Restart Ollama** button in Settings uses the local `ollama serve` workflow by default. Set `OLLAMA_RESTART_CMD` if your machine needs a custom restart command such as a service manager command.

Runtime environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `OFFLINEAI_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only when you want LAN access. |
| `OFFLINEAI_PORT` | `8080` | Web server port. |
| `OFFLINEAI_TOKEN` | auto-generated in LAN mode | API token required for non-local LAN clients. |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint. |
| `OLLAMA_RESTART_CMD` | *(none)* | Custom command to restart Ollama (e.g. a service manager command). |
| `WHISPER_MODEL` | `tiny` | Whisper model size for audio transcription. |
| `OFFLINEAI_IMAGE_MAX_WIDTH` | `1024` | Maximum width (px) for generated images. |
| `OFFLINEAI_IMAGE_MAX_HEIGHT` | `1024` | Maximum height (px) for generated images. |
| `OFFLINEAI_IMAGE_MAX_STEPS` | `16` | Maximum diffusion steps for image generation. |
| `OFFLINEAI_IMAGE_DEFAULT_WIDTH` | `640` | Default width (px) for generated images. |
| `OFFLINEAI_IMAGE_DEFAULT_HEIGHT` | `640` | Default height (px) for generated images. |
| `OFFLINEAI_IMAGE_DEFAULT_STEPS` | `6` | Default diffusion steps for image generation. |
| `OFFLINEAI_MAX_TOKEN_ENTRIES` | `500` | Maximum entries in the token stats log. |

---

## API Endpoints

### Chat & Models
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/models` | List available Ollama models |
| GET | `/api/status` | Ollama connection status |
| GET | `/api/health` | Full system health diagnostics |
| POST | `/api/chat` | Stream a chat completion (accepts `project_id` for knowledge injection) |
| POST | `/api/show` | Show model details |
| POST | `/api/pull` | Pull/download a model |
| POST | `/api/ollama/restart` | Restart Ollama process |
| POST | `/api/suggest-followups` | Generate follow-up question suggestions |

### Queue
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/queue/status` | Current operation queue status |
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tokens` | Get per-user token usage statistics |
| DELETE | `/api/tokens` | Reset token counts for a user |

### Memory
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/memory` | Get all saved memory entries |
| POST | `/api/memory` | Add a memory entry |
| DELETE | `/api/memory/{index}` | Delete a memory entry by index |

### Tools / Plugins
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tools` | List all custom tools |
| GET | `/api/tools/{name}` | Get full tool details including source code |
| POST | `/api/tools/{name}/execute` | Execute a tool with given parameters |
| DELETE | `/api/tools/{name}` | Delete a tool |
| POST | `/api/tools/{name}/toggle` | Enable or disable a tool |
| POST | `/api/tools/{name}/preview` | Preview tool source code and sample invocation |
| POST | `/api/tools/build` | Build a new tool from a description |

### Web Search & Pages
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/search` | Search the web via DuckDuckGo |
| POST | `/api/fetch-page` | Fetch a URL and return clean text |

### Research Projects
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a new project |
| GET | `/api/projects/{id}` | Get project metadata |
| DELETE | `/api/projects/{id}` | Delete a project |
| PUT | `/api/projects/{id}` | Rename or update a project |
| GET | `/api/projects/{id}/files` | List project files |
| GET | `/api/projects/{id}/files/{path}` | Read a file |
| POST | `/api/projects/{id}/files/{path}` | Write a file |
| DELETE | `/api/projects/{id}/files/{path}` | Delete a file |
| POST | `/api/projects/{id}/files/move` | Move or rename a file within the project |
| GET | `/api/projects/{id}/files/{path}/versions` | List version history for a file |
| GET | `/api/projects/{id}/files/{path}/versions/{version}` | Retrieve a specific version of a file |
| POST | `/api/projects/{id}/files/{path}/restore/{version}` | Restore a file to a previous version |
| GET | `/api/projects/{id}/download/{path}` | Download a file |
| GET | `/api/projects/{id}/view/{path}` | View a file inline in the browser |
| GET | `/api/projects/{id}/knowledge` | Get project knowledge base |

### Generation
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/projects/{id}/research` | Autonomous multi-step research (SSE) |
| POST | `/api/projects/{id}/research/plan` | Generate a research query plan for review before execution |
| POST | `/api/projects/{id}/research/execute` | Execute an approved research plan |
| POST | `/api/projects/{id}/generate-document` | Generate a Markdown document (SSE) |
| POST | `/api/projects/{id}/generate-code` | Generate multi-file code project (SSE) |
| POST | `/api/projects/{id}/generate-data` | Generate CSV/JSON data (SSE) |
| POST | `/api/projects/{id}/export-pdf` | Export Markdown to PDF |
| POST | `/api/projects/{id}/export-docx` | Export Markdown to DOCX |
| POST | `/api/projects/{id}/export-html` | Export Markdown to standalone HTML |
| POST | `/api/projects/{id}/workflow` | Multi-step workflow (SSE) |

### Spec-Driven Code Workflow
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/projects/{id}/code/plan` | Start spec workflow: questions, research, generate requirements.md (SSE) |
| GET | `/api/projects/{id}/code/spec` | Get all spec documents and current phase |
| POST | `/api/projects/{id}/code/spec/approve` | Approve current spec phase and advance to next |
| POST | `/api/projects/{id}/code/spec/generate` | Generate next spec document — design.md or tasks.md (SSE) |
| POST | `/api/projects/{id}/code/task/execute` | Execute a single implementation task from tasks.md (SSE) |
| POST | `/api/projects/{id}/code/generate` | Generate code from an approved plan (SSE) |
| POST | `/api/projects/{id}/code/import` | Import existing folder, scan files, generate steering docs (SSE) |
| POST | `/api/projects/{id}/code/analyze` | Plan changes to imported code: questions → change plan (SSE) |
| POST | `/api/projects/{id}/code/edit` | Apply code changes with version tracking (SSE) |
| GET | `/api/projects/{id}/code/session` | Get current code session state |
| DELETE | `/api/projects/{id}/code/session` | Close and delete code session |

### Steering Documents
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/projects/{id}/steering/generate` | Generate steering documents — product.md, tech.md, structure.md (SSE) |
| GET | `/api/projects/{id}/steering` | List all steering documents |
| GET | `/api/projects/{id}/steering/{doc}` | Read a steering document |
| PUT | `/api/projects/{id}/steering/{doc}` | Update a steering document |

### Agent Hooks
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/projects/{id}/hooks` | List all hooks for a project |
| POST | `/api/projects/{id}/hooks` | Create a new hook (LLM generates optimized system prompt) |
| PUT | `/api/projects/{id}/hooks/{hookId}` | Update a hook |
| DELETE | `/api/projects/{id}/hooks/{hookId}` | Delete a hook |
| POST | `/api/projects/{id}/hooks/{hookId}/toggle` | Enable or disable a hook |
| POST | `/api/projects/{id}/hooks/{hookId}/execute` | Manually trigger a hook |

### Media
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/transcribe` | Transcribe audio via Whisper (SSE) |
| POST | `/api/extract` | Extract text from documents |
| POST | `/api/generate-image` | Generate an image via diffusion model |

### Data Portability
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/export-archive` | Export all data as a ZIP archive |
| POST | `/api/import-archive` | Import a ZIP archive (merge with existing data) |

---

## Privacy

- All conversation data stays on your device
- Research projects are stored as plain files on your disk (`~/OfflineAI-Projects/`)
- Web search queries go to DuckDuckGo — no accounts, no tracking, no API keys
- The web server binds to `127.0.0.1` by default; LAN access is opt-in
- History is stored in browser IndexedDB on the user's device
- No analytics or telemetry
- Base64 image data is stripped before saving to history to minimise storage use

---

## Tests

```bash
# Backend unit tests
python -m pytest

# React component & utility unit tests
cd react-app && npm test

# End-to-end browser tests (90 tests, requires the server to be stopped first)
cd react-app && npm run test:ui
```

The **backend tests** (71 tests across 8 files) cover the UI route, Ollama-offline fallback behaviour, request size limits, LAN token auth, the RestrictedPython sandbox, operation queue, prompt assembly, knowledge store, memory service, project operations, and version history.

The **React unit tests** (73 tests) cover individual components (`MessageBubble`, `MessageInput`, `Sidebar`, modals) and utility functions (API helpers, file handling, markdown rendering, local storage).

The **Playwright E2E suite** (90 tests) covers the full user journey end-to-end:

| Section | What is tested |
|---|---|
| Smoke | Page loads, key elements present |
| Name modal | Submit, dismiss, Escape lock, 32-char truncation |
| Connection status | Online/offline/LAN states, tooltip |
| Token counter | Starts at 0, k-suffix formatting, visibility |
| Welcome screen | Greeting, model shown, hides/reappears on chat |
| Chat | Send, streaming, empty-input guard, error bubble, copy, regenerate, avatars |
| New chat | Clears messages, resets model |
| Settings panel | All fields, save, defaults, model health, Ollama restart, downloaded models |
| Model selection | Selector present, persists per conversation |
| History sidebar | Open/close, Cmd+L toggle, search, load, delete conversations |
| Keyboard shortcuts modal | Open via button/`?`, close via button/Escape/backdrop |
| System prompts | Add, delete, duplicate, star default, edit, appears in selector |
| Model pull | Status messages, Enter key, clears input on success, error state |
| Danger zone | Cancel keeps history, confirm clears history |
| Export | Button visible, Cmd+E, click triggers Markdown download |
| Focus mode | Cmd+Shift+F toggles `focus-mode` class on body |
| Keyboard focus shortcuts | Cmd+K, Cmd+/, Cmd+E, Cmd+L via keyboard |

---

## License

MIT
