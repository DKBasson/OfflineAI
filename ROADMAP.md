# OfflineAI Product Roadmap

> From strong open-source foundation to a sellable local-first research-and-creation workstation.
> Status: **active** · Last updated: 2026-08-31 · Phases 0–3 complete, Phases 4–5 pending

---

## 1. Vision

Turn OfflineAI from a feature-rich repo into a **product people pay for**: a private, offline-first workstation where researchers, analysts, writers, and builders go from a question to a finished, cited artifact (report, dataset, code project, slide deck) without their data ever leaving the machine.

Two guiding lenses for every decision:

1. **Streamlined for research and creation.** The core loop (ask, research, create, refine, export) should feel like one continuous workspace, not a chat with hidden commands.
2. **Complete, sellable product.** One-click install, guided onboarding, a licensing model, brand, and legal footing.

---

## 2. Current state

### 2.1 What is already strong

- Clean FastAPI backend: 62 endpoints, SSE streaming, sensible middleware (LAN token auth, 50 MB body cap).
- Well-structured React 18 + TypeScript + Vite frontend with state split into 6 focused context slices.
- Genuinely local stack: Ollama (chat), DuckDuckGo via `ddgs` (search), faster-whisper (audio), WeasyPrint (PDF), Diffusers (image generation).
- Differentiated capabilities already built: autonomous research agent, multi-step workflows, self-building tool/plugin system, persistent memory, research projects, artifact canvas, inline citations.
- Real test coverage: 234 tests across pytest (71), Vitest (73), and Playwright (90).
- Thoughtful security: path-traversal prevention, tool-code sandbox (RestrictedPython 3-layer: denylist + AST import allowlist + RestrictedPython compilation), expanded validation blocklist (21 patterns), localhost-only runtime controls.

### 2.2 Gaps found and addressed

| # | Issue | Status | Resolution |
|---|---|---|---|
| G1 | Image generation depends on removed Ollama feature | ✅ **Fixed** | Replaced with local Diffusers backend (`image_gen.py`, SDXL Turbo) |
| G2 | `/research` hard-codes `depth: 'standard'` | ✅ **Fixed** | `handleSlashCommand` now accepts depth; `/research --deep <topic>` works |
| G3 | Slash commands only discoverable via placeholder | ✅ **Fixed** | `SlashCommandPalette.tsx` — full autocomplete with sub-pickers |
| G4 | Results render as plain text, disconnected from artifacts | ✅ **Fixed** | `ArtifactCanvas.tsx` — split-pane live preview with streaming |
| G5 | Empty stub directories under `scripts/` | ✅ **Fixed** | Deleted all 5 empty directories |
| G6 | Documentation says "37 endpoints", actual is 62 | ✅ **Fixed** | Updated `DOCUMENTATION.md` architecture summary |
| G7 | `/workflow` missing from input placeholder | ✅ **Fixed** | Added to placeholder hint |
| G8 | Intent detection opaque to user | 🔲 **Open** | Deferred to Phase 4/5; surfacing intent tier in UI |

---

## 3. Track A — Streamline research and creation · ✅ Complete

### A1. Slash-command palette and autocomplete · ✅ Done
- `SlashCommandPalette.tsx` (436 lines) — typing `/` opens an inline floating menu.
- All 6 commands with icons, descriptions, keyboard hints (↑↓ navigate, ↵ select, Esc close).
- Filters as you type (e.g. `/res` → only `/research`).
- Sub-pickers: depth for `/research` (quick/standard/deep), type for `/document` (report/summary/analysis), format for `/data` (csv/json).
- Integrated into `MessageInput.tsx`.

### A2. Artifact canvas · ✅ A2a + A2b done, A2c–A2d remaining

| Phase | Status | What was built |
|---|---|---|
| A2a | ✅ **Done** | Read-only preview pane: split-pane layout (chat left, canvas right), live Markdown/code/CSV/JSON/text rendering, pulsing streaming cursor, download button, generated files section. Integrated into `App.tsx` and `useStreamingSlice.ts`. |
| A2b | ✅ **Done** | In-place text editing: edit toggle in header, full-height textarea with line numbers, save to backend via `writeProjectFile()`, ⌘S shortcut, cancel/revert. |
| A2c | 🔲 **Not started** | Targeted AI revision: select a section and prompt "revise this", "expand", "make concise". |
| A2d | 🔲 **Not started** | Multi-tab artifacts: tab switcher when a workflow produces multiple outputs. |

### A3. Interactive research pipeline · ✅ Complete
- `ResearchPipeline.tsx` (701 lines) — editable query plan, phase stepper (plan → searching → reading → extracting → synthesizing → done), live source list with include/exclude toggles, done state with "View Report" button.
- Backend two-phase research endpoints: `POST /api/projects/{id}/research/plan` generates the query plan, `POST /api/projects/{id}/research/execute` runs an approved plan.

### A4. Inline citations · ✅ Done
- Research synthesis prompt instructs LLM to use `[1]`, `[2]` citation markers.
- Sources numbered as `[1] Title: URL` in synthesis context.
- New `source_map` SSE event provides `{index, title, url}` for frontend rendering.
- Finding extraction tags findings with source attribution.
- Document generation also uses numbered citations when project knowledge is available.

### A5. Creation templates · ✅ Done
- 5 `CREATION_TEMPLATES` in `constants.ts`: 📚 Literature Review (deep), 📊 Competitive Analysis (standard), ✍️ Blog Post (quick), 📈 Data Report (standard), 🔧 Technical Spec (standard).
- `ProjectsPanel.tsx` updated: template cards in create form, auto-fills name, auto-executes `/workflow` on creation.

### A6. Multi-format export · ✅ Done (DOCX + HTML; PPTX deferred)
- `POST /api/projects/{id}/export-docx` — Markdown to DOCX via python-docx with heading/list/code/blockquote parsing.
- `POST /api/projects/{id}/export-html` — Markdown to standalone HTML with embedded CSS and dark mode.
- Export buttons (DOCX, HTML, PDF) in artifact canvas header.
- **PPTX deferred** — requires `python-pptx` and a more complex slide-building approach. Lower priority than the other formats.

### A7. Fix image generation · ✅ Done
- **Ollama status (as of 2026-08-31)**: Image generation was added experimentally Jan 20, 2026 (macOS only), removed in v0.32.6 (Aug 6, 2026) as "temporarily removed." Still absent through v0.33.0 (Aug 21). No public timeline for restoration.
- **What was built**: `image_gen.py` — local Diffusers pipeline with `stabilityai/stable-diffusion-xl-turbo` as default. Auto-detects MPS (Apple Silicon) → CUDA → CPU. Lazy loading with thread safety. Configurable via `OFFLINEAI_IMAGE_MODEL` env var.
- `/api/generate-image` endpoint replaced — same NDJSON streaming contract, frontend unchanged.
- Frontend Ollama v0.32.6 error message removed.
- Added `diffusers`, `torch`, `transformers`, `accelerate`, `safetensors` to requirements.txt.

### A8. Tool sandbox and trust story · ✅ Done
- **Sandboxed execution**: Tools run through a 3-layer sandbox: denylist check, AST import allowlist, and RestrictedPython compilation. Timeout enforcement and stdout/stderr capture.
- **Preview endpoint**: `POST /api/tools/{name}/preview` — returns source code and sample invocation without executing.
- **Build preview mode**: `POST /api/tools/build` with `"preview": true` generates code for review without registering.
- **Enhanced validation**: Blocked patterns expanded from 10 to 21 — now also blocks `socket`, `requests`, `urllib.request`, `http.client`, `pickle`, `marshal`, `ctypes`, `cffi`, `sys.exit`, `os.environ`, `importlib`.
- **Not yet built**: undo/rollback for tool-produced files.

---

## 4. Track B — Make it a sellable product · Partially addressed

| Area | Status | Notes |
|---|---|---|
| Packaging | 🔲 **Not started** | Desktop app (Tauri vs Electron spike needed). |
| Onboarding | 🔲 **Not started** | First-run wizard with hardware detection. |
| Licensing | 🔲 **Not started** | Offline license key system. |
| Legal | 🔲 **Not started** | LICENSE, Terms, Privacy, model-license audit. |
| Brand | 🔲 **Not started** | Product name, logo, landing page. |
| Reliability | ✅ **Done** | `GET /api/health` with full diagnostics; health dashboard in SystemSettings with service indicators, RAM bar, recovery suggestions. |
| Data portability | ✅ **Done** | `GET /api/export-archive` (ZIP), `POST /api/import-archive` (merge import); UI buttons in SystemSettings. |
| Auto-update | 🔲 **Not started** | Requires desktop packaging first. |
| Cross-platform parity | 🔲 **Not started** | Windows/Linux install quality. |

---

## 5. Phased roadmap

### Phase 0 — Cleanup and unblock · ✅ Complete
- ✅ Deleted empty stub directories under `scripts/` (G5).
- ✅ Added `/workflow` to placeholder hint (G7).
- ✅ Research depth now passed through `handleSlashCommand` with `--quick`/`--deep` flags (G2).
- ✅ Fixed `DOCUMENTATION.md` endpoint count: 37 → 62 (G6).

### Phase 1 — Streamline the core loop · ✅ Complete
- ✅ A1 Slash-command palette and autocomplete (`SlashCommandPalette.tsx`).
- ✅ A2a Artifact canvas read-only preview (`ArtifactCanvas.tsx`) — integrated into App.tsx layout and useStreamingSlice.
- ✅ A2b Artifact canvas in-place editing — edit toggle, textarea with line numbers, save to backend.
- ✅ A3 Interactive research pipeline — frontend component built (`ResearchPipeline.tsx`), backend two-phase research endpoints implemented.

### Phase 2 — Credibility and output quality · ✅ Complete
- ✅ A4 Inline citations — synthesis prompts, numbered source references, `source_map` SSE events.
- ✅ A6 Multi-format export — DOCX + HTML endpoints and artifact canvas export buttons. PPTX deferred.
- ✅ A5 Creation templates — 5 templates with auto-workflow execution.
- 🔲 A2c Targeted AI revision — not started.

### Phase 3 — Fix and harden · ✅ Complete
- ✅ A7 Diffusers-based image generation replacing broken Ollama proxy.
- ✅ A8 Tool sandbox — subprocess isolation, preview endpoint, build preview mode, expanded blocklist.
- ✅ Health dashboard — `GET /api/health`, SystemSettings UI with service indicators and recovery suggestions.
- ✅ Data portability — export/import ZIP archive with merge semantics.

### Phase 4 — Product-ize for sale · 🔲 Not started · *~8–12 weeks*
- Desktop packaging (Tauri or Electron — run a 1-week spike first) with managed Ollama.
- First-run onboarding wizard with hardware detection and model-tier recommendation.
- Offline licensing and tiering.

**Prerequisites**: brand name decided (Phase 5 dependency), Tauri vs Electron spike completed.

### Phase 5 — Go to market · 🔲 Not started · *~4–6 weeks*
- Brand, name, and landing page.
- Legal pack and model-license audit.
- Auto-update and cross-platform parity.

---

## 6. What still needs to be done

### Remaining implementation work

| Item | Priority | Effort | Depends on |
|---|---|---|---|
| A2c Targeted AI revision (select + revise in artifact canvas) | Medium | ~3 weeks | — |
| A2d Multi-tab artifacts | Low | ~1 week | A2c |
| A6 PPTX export | Low | ~1 week | python-pptx dependency |
| G8 Surface intent/routing decisions in UI | Low | ~3 days | — |
| Tool undo/rollback | Low | ~1 week | — |

### Product decisions needed (blocking Phase 4)

| Decision | Options | Impact |
|---|---|---|
| **Product name** | Current "OfflineAI" is generic and trademark-risky. Needs a distinct name. | Blocks landing page, legal filings, desktop app naming. |
| **Tauri vs Electron** | Tauri (Rust, smaller binary) vs Electron (JS ecosystem, easier). 1-week spike recommended. | Blocks desktop packaging. |
| **License model** | One-time purchase vs Free + Pro tiers vs subscription. | Blocks licensing implementation and feature gating. |
| **Default model** | `gemma4:e4b` currently. Need model-license audit for commercial bundling. | Blocks legal pack. Gemma has permissive terms; other models may not. |
| **Image gen model** | SDXL Turbo (current default). ~5 GB download. Should it be opt-in? | Impacts install size and first-run experience. |

### Infrastructure work needed for productization

| Item | Priority | Effort |
|---|---|---|
| Desktop app packaging (Tauri/Electron) | High | ~4–6 weeks |
| First-run onboarding wizard | High | ~2 weeks |
| Offline license key system | High | ~2 weeks |
| Auto-update channel | Medium | ~1 week |
| Windows/Linux install parity | Medium | ~2 weeks |
| Landing page and marketing site | Medium | ~1 week |
| Legal pack (LICENSE, Terms, Privacy, attributions) | High | ~1 week |
| Model-license audit | High | ~2 days |

---

## 7. Positioning and differentiation

Why someone buys this instead of using a cloud chatbot:

- **Verifiable privacy.** Not "we promise", but "it physically cannot leave; it is air-gappable". Lean into regulated and sensitive use cases (legal, medical, finance, research).
- **Research-to-artifact pipeline.** Most tools stop at chat. This one produces cited reports, datasets, code, and slides you can hand off.
- **Self-building tools.** A genuinely unique capability. Now with sandbox isolation and code preview, it is reliable and safe — a headline differentiator rather than a novelty.

Primary audiences: independent researchers and analysts, graduate students, technical writers, privacy-sensitive professionals, and small consultancies.

### 7.1 Competitive landscape

| Competitor | Strengths | Where OfflineAI wins |
|---|---|---|
| **LM Studio** | Polished model management, broad model support, clean UX | No research pipeline, no project system, no tool building, no web search, no generation workflows. LM Studio is an inference UI; OfflineAI is a research workstation. |
| **Jan** | Open source, plugin ecosystem, conversation-focused | No autonomous research agent, no multi-step workflows, no artifact generation, no persistent memory. |
| **GPT4All** | Wide model support, simple install, enterprise positioning | No web search, no project-based research, no slash commands, no tool builder. |
| **Msty** | Multi-model chat, knowledge-base RAG, polished desktop app | No autonomous research, no multi-step workflows, no self-building tools. Msty focuses on RAG chat, not research-to-artifact. |
| **Cloud chatbots** (ChatGPT, Claude, Gemini) | Best model quality, vast ecosystems, fast iteration | Data leaves the machine. Subscription cost. No air-gap. OfflineAI wins on verifiable privacy and the complete local research-to-export pipeline. |

**The gap to own:** None of the local-first tools offer a research → synthesize → generate → export pipeline. That is the wedge.

---

## 8. Hardware and performance strategy

"It runs locally" means users will hit hardware walls. The product must handle this gracefully rather than failing silently.

### 8.1 Hardware tiers

| Tier | Example device | RAM | Recommended models | Expected experience |
|---|---|---|---|---|
| **Entry** | MacBook Air 8 GB, budget Windows laptop | 8 GB | `gemma3:1b`, `phi4-mini` (3B), no image gen | Chat + basic research. Slower generation. |
| **Mid** | MacBook Air/Pro 16 GB, desktop with 16 GB | 16 GB | `gemma4:e4b` (12B), SDXL Turbo image gen | Full features. Comfortable performance. |
| **Power** | MacBook Pro 32–64 GB, gaming PC with 24 GB VRAM | 32+ GB | `llama3.3:70b-q4`, full image gen | Fast generation, large context windows. |

### 8.2 What to build

- **Onboarding hardware scan**: detect available RAM and GPU at first launch; recommend a model tier and pull the right models automatically. *(Part of Phase 4 onboarding wizard.)*
- **Graceful degradation**: if a model is too large, warn before pulling, suggest a smaller alternative. If inference OOMs, catch the error and suggest reducing context size or switching models.
- **Performance profiles**: extend the existing image performance profiles concept to chat (e.g., "Fast" with small model and low context vs "Thorough" with large model and 32k context).
- **Resource monitor**: ✅ Partially done — health dashboard shows RAM/disk. A real-time widget during inference is a future enhancement.

---

## 9. Monetization options

- **One-time license** (Pro), fits the offline-first, no-subscription ethos best.
- **Free tier plus Pro tier**: Free covers chat and basic research; Pro unlocks the artifact canvas, multi-format export, workflows, image generation, and the tool builder.
- **Team pack**: multi-seat license files for small organizations.
- Keep all tiers fully offline; licensing must never require a server round-trip.

---

## 10. Appendix — code-level fixes scheduled

| Ref | Fix | Status | File |
|---|---|---|---|
| G1 | Route image gen to local Diffusers backend | ✅ Done | `image_gen.py`, `app.py`, `useStreamingSlice.ts` |
| G2 | Pass research depth through handleSlashCommand | ✅ Done | `useStreamingSlice.ts` |
| G3 | Slash-command menu component | ✅ Done | `SlashCommandPalette.tsx`, `MessageInput.tsx` |
| G4 | Artifact rendering surface | ✅ Done | `ArtifactCanvas.tsx`, `App.tsx`, `AppContext.tsx`, `useStreamingSlice.ts` |
| G5 | Delete empty stub directories | ✅ Done | `scripts/` |
| G6 | Update endpoint count in docs | ✅ Done | `DOCUMENTATION.md` |
| G7 | Add `/workflow` to placeholder | ✅ Done | `MessageInput.tsx` |
| G8 | Surface intent/routing in UI | 🔲 Open | Deferred |

---

## 11. Files changed in this implementation cycle

### New files
| File | Purpose |
|---|---|
| `DOCUMENTATION.md` | Comprehensive 1,140-line technical reference |
| `image_gen.py` | Local Diffusers image generation module |
| `react-app/src/components/SlashCommandPalette.tsx` | Slash-command autocomplete menu |
| `react-app/src/components/ArtifactCanvas.tsx` | Split-pane artifact preview and editing |
| `react-app/src/components/ResearchPipeline.tsx` | Interactive research pipeline UI |

### Modified files
| File | Changes |
|---|---|
| `README.md` | Updated with 32 previously missing features |
| `ROADMAP.md` | This file — corrected factual errors, added new sections |
| `app.py` | Refactored to 146-line composition root; all logic moved to services/ and routes/ |
| `services/` | **New** — 14 service modules (config, tokens, system, memory, projects, tools, research, media, ollama, sandbox, queue, prompt_assembly, knowledge_store, versions) |
| `routes/` | **New** — 10 route modules (ui, models, chat, tokens, media, projects, generation, tools, memory, portability) |
| `requirements.txt` | Added diffusers, torch, transformers, accelerate, safetensors, RestrictedPython |
| `requirements-dev.txt` | **New** — Test dependencies (pytest, etc.) |
| `react-app/src/constants.ts` | Added `CREATION_TEMPLATES` |
| `react-app/src/App.tsx` | Artifact canvas integration, split-pane layout |
| `react-app/src/context/AppContext.tsx` | Artifact canvas state and actions |
| `react-app/src/context/hooks/useStreamingSlice.ts` | Research depth, artifact canvas streaming, Ollama error removal |
| `react-app/src/components/MessageInput.tsx` | Slash palette integration, `/workflow` in placeholder |
| `react-app/src/components/ProjectsPanel.tsx` | Creation templates |
| `react-app/src/components/ArtifactCanvas.tsx` | Export buttons, edit mode |
| `react-app/src/components/settings/SystemSettings.tsx` | Health dashboard, data portability UI |
| `react-app/src/utils/api.ts` | Export/import archive API calls |
| `scripts/install.sh` | Updated image model comments |
| `scripts/install.bat` | Updated image model comments |

### Deleted
| Path | Reason |
|---|---|
| `frontend/` | Legacy frontend replaced by react-app/ |
| `index.html` | Legacy frontend entry point |
| `styles.css` | Legacy frontend styles |
| `scripts/run/` | Empty stub directory |
| `scripts/models/` | Empty stub directory |
| `scripts/docker/` | Empty stub directory |
| `scripts/install/` | Empty stub directory |
| `scripts/learning-layer/` | Empty stub directory |
