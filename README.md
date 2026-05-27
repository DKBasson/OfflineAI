# OfflineAI

A local-first AI chat app that runs entirely on your device. No cloud, no subscriptions, no data leaving your machine.

Built with [Ollama](https://ollama.com), FastAPI, and a React/TypeScript frontend.

---

## Features

- **Fully offline** — all inference runs locally via Ollama
- **iOS 26 glass design** — backdrop blur, safe-area insets, mobile-responsive
- **Conversation history** — persisted locally in browser IndexedDB with search and AI-generated titles
- **System prompts** — save, duplicate, reorder, and set a default prompt for new conversations
- **Image & file support** — attach images or text files via picker, drag-and-drop, or paste
- **Image generation** — ask the model to draw or generate an image using a local diffusion model
- **Per-chat model selection** — choose a different Ollama model for each conversation
- **Local tuning controls** — adjust temperature, top-p, reply tokens, model context tokens, and saved chat limit
- **Markdown rendering** — with syntax highlighting and copy-to-clipboard
- **Export conversations** — download any chat as a Markdown file
- **Model pull** — download new Ollama models directly from the Settings panel
- **Ollama restart** — restart the local Ollama runtime from Settings
- **Cumulative token counter** — tracks total input/output tokens locally and can be reset in Settings
- **Keyboard shortcuts** — full keyboard navigation (`?` to see all shortcuts)
- **LAN access** — opt-in serving to devices on your local network
- **LAN token auth** — LAN launch scripts generate a one-time access token automatically
- **Message controls** — copy messages and regenerate the latest assistant response
- **Audio transcription** — upload `.mp3`, `.wav`, `.opus`, `.m4a`, and other audio files via Whisper
- **Document reading** — attach `.docx`, `.odt`, `.ods`, `.odp`, and `.pdf` files
- **No CDN at runtime** — highlight.js assets vendored locally with checksum verification

---

## Requirements

### macOS
- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) (installed automatically if missing)
- Python 3.10+
- ~4 GB free disk space for the model

### Windows
- Windows 10 or 11
- [Python 3.10+](https://www.python.org/downloads/) — check **"Add Python to PATH"** during install
- [Ollama for Windows](https://ollama.com/download/windows) — install before running `scripts\install.bat`
- ~4 GB free disk space for the model

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

| Action | How |
|---|---|
| Send message | **Enter** |
| New line in input | **Shift+Enter** |
| New chat | **⌘K** / **Ctrl+K** |
| Toggle history sidebar | **⌘L** / **Ctrl+L** |
| Export conversation | **⌘E** / **Ctrl+E** |
| Focus input | **⌘/** / **Ctrl+/** |
| Focus mode | **Shift+⌘F** / **Shift+Ctrl+F** |
| Show all shortcuts | **?** |
| Attach image or file | Click 📎, drag-and-drop, or paste |
| Stop generation | Click the red ■ stop button |
| Search history | Open History and type in the search field |
| Choose model | Use the Model selector above the message box |
| Copy / regenerate | Hover a message and use its action buttons |
| View full-size image | Click any image in the chat |

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM backend | [Ollama](https://ollama.com) (`gemma4:e4b`) |
| Web server | [FastAPI](https://fastapi.tiangolo.com) + [uvicorn](https://www.uvicorn.org) |
| HTTP client | [httpx](https://www.python-httpx.org) (async streaming) |
| Frontend | [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org) + [Vite](https://vitejs.dev) |
| Styling | [Tailwind CSS](https://tailwindcss.com) v3 |
| Markdown | [marked.js](https://marked.js.org) v12 |
| Sanitisation | [DOMPurify](https://github.com/cure53/DOMPurify) v3 |
| Syntax highlighting | [highlight.js](https://highlightjs.org) 11.9 |
| Audio transcription | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (Whisper `tiny`) |
| Document parsing | python-docx, odfpy, pypdf |

---

## Project Structure

```
OfflineAI/
├── app.py              # FastAPI backend — serves UI, proxies Ollama
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
│   │   ├── context/        # AppContext (global state)
│   │   └── utils/          # api, storage, markdown, files
│   └── package.json
├── react-dist/         # Vite build output (served by FastAPI, gitignored)
├── static/             # Vendored highlight.js assets (generated by installer, gitignored)
└── tests/              # Backend and UI tests
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

Most runtime preferences live in the browser only under **Settings**. These include generation sampling, model context tokens, auto-title behavior, saved history limit, and token counter reset. Attached images are sent as their original browser file data without client-side compression.

The **Restart Ollama** button in Settings uses the local `ollama serve` workflow by default. Set `OLLAMA_RESTART_CMD` if your machine needs a custom restart command such as a service manager command.

Runtime environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `OFFLINEAI_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only when you want LAN access. |
| `OFFLINEAI_PORT` | `8080` | Web server port. |
| `OFFLINEAI_TOKEN` | auto-generated in LAN mode | API token required for non-local LAN clients. |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint. |

---

## Privacy

- All conversation data stays on your device
- The web server binds to `127.0.0.1` by default; LAN access is opt-in
- History is stored in browser IndexedDB on the user's device
- No analytics or telemetry
- Base64 image data is stripped before saving to history to minimise storage use

---

## Tests

```bash
# Backend tests
python -m pytest

# React unit tests
cd react-app && npm test

# Browser smoke tests
npm install && npm run test:ui
```

The backend tests cover the UI route, Ollama-offline fallback behaviour, request size limits, and LAN token auth. The React tests cover components and utility functions.

---

## License

MIT
