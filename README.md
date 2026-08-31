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
├── app.py              # FastAPI backend — serves UI, proxies Ollama, research agent
├── requirements.txt    # Python dependencies
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
└── tests/              # Backend and UI tests
```

### Research Projects folder

When you create projects, they live at:

```
~/OfflineAI-Projects/
└── <project-name>/
    ├── knowledge.json    # Sources, findings, metadata
    ├── notes/            # Research summaries (auto-generated)
    ├── sources/          # Saved source content
    └── output/           # Generated documents, code, data
        ├── *.md          # Generated reports
        ├── data/         # CSV/JSON datasets
        └── code/         # Multi-file code projects
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
| `OFFLINEAI_IMAGE_DEFAULT_WIDTH` | `768` | Default width (px) for generated images. |
| `OFFLINEAI_IMAGE_DEFAULT_HEIGHT` | `768` | Default height (px) for generated images. |
| `OFFLINEAI_IMAGE_DEFAULT_STEPS` | `10` | Default diffusion steps for image generation. |
| `OFFLINEAI_MAX_TOKEN_ENTRIES` | `1000` | Maximum entries in the token stats log. |

---

## API Endpoints

### Chat & Models
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/models` | List available Ollama models |
| GET | `/api/status` | Ollama connection status |
| POST | `/api/chat` | Stream a chat completion (accepts `project_id` for knowledge injection) |
| POST | `/api/show` | Show model details |
| POST | `/api/pull` | Pull/download a model |
| POST | `/api/ollama/restart` | Restart Ollama process |
| POST | `/api/follow-ups` | Generate follow-up question suggestions |

### Memory
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/memory` | Get all saved memory entries |
| POST | `/api/memory` | Add a memory entry |
| DELETE | `/api/memory/{id}` | Delete a memory entry |

### Tools / Plugins
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tools` | List all custom tools |
| POST | `/api/tools` | Create a new tool |
| PUT | `/api/tools/{id}` | Update a tool |
| DELETE | `/api/tools/{id}` | Delete a tool |
| POST | `/api/tools/{id}/test` | Test-run a tool |
| POST | `/api/tools/{id}/toggle` | Enable or disable a tool |
| GET | `/api/tools/{id}/logs` | Get tool execution logs |

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
| GET | `/api/projects/{id}/files` | List project files |
| GET | `/api/projects/{id}/files/{path}` | Read a file |
| POST | `/api/projects/{id}/files/{path}` | Write a file |
| DELETE | `/api/projects/{id}/files/{path}` | Delete a file |
| GET | `/api/projects/{id}/download/{path}` | Download a file |
| GET | `/api/projects/{id}/knowledge` | Get project knowledge base |

### Generation
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/projects/{id}/research` | Autonomous multi-step research (SSE) |
| POST | `/api/projects/{id}/generate-document` | Generate a Markdown document (SSE) |
| POST | `/api/projects/{id}/generate-code` | Generate multi-file code project (SSE) |
| POST | `/api/projects/{id}/generate-data` | Generate CSV/JSON data (SSE) |
| POST | `/api/projects/{id}/export-pdf` | Export Markdown to HTML/PDF |
| POST | `/api/projects/{id}/workflow` | Multi-step workflow (SSE) |

### Media
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/transcribe` | Transcribe audio via Whisper (SSE) |
| POST | `/api/extract` | Extract text from documents |
| POST | `/api/generate-image` | Generate an image via diffusion model |

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
npm run test:ui
```

The **backend tests** (10 tests) cover the UI route, Ollama-offline fallback behaviour, request size limits, and LAN token auth.

The **React unit tests** (~82 tests) cover individual components (`MessageBubble`, `MessageInput`, `Sidebar`, modals) and utility functions (API helpers, file handling, markdown rendering, local storage).

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
